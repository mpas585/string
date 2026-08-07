/*
  shares.js — 読み込んだ楽譜を「みんなの曲」として公開する（フロント側）。

  サーバは api/shares.php（実処理は includes/shares.php・保存は SQLite の shares テーブル）。

    公開する         … 「譜面を読み込む」の一覧の［シェア］→ openShare() → #mShare → doShare()
                       曲名はアップロードした楽譜の名前をそのまま使う（#mShare に入力欄は無い）。
                       あとから一覧の「名前」で変えると、公開ぶんの曲名も一緒に変わる
                       （サーバ側 includes/shares.php の share_rename_by_score）。
    一覧に出す       … refreshShares()（起動時とログイン状態が変わるたび）
                       中身を並べるのは src/songs.js の renderSongList()。
                       あらかじめ用意した曲と同じ一覧に混ざって出る。
    一覧から開く     … loadShared()（曲一覧のボタン。配線は main.js）
    公開をやめる     … unshareSong()（自分の投稿にだけ出る）
    削除依頼         … reportShare()（受け付けた時点でサーバ側が非公開にする）
    管理             … openAdmin() / refreshAdmin() / adminAction()
                       歯車（設定）の中の「共有曲の管理」。管理者にだけ出る。

  ※ 公開されるのは「音の並び」だけ。運指も、読み込みに使った元のファイルも公開しない
     （サーバ側で scores の data 列だけを写している＝includes/shares.php の share_create）。
  ※ 共有された曲は伴奏コード（chords）を持たない。したがって ST.songChords は null のままで、
     伴奏ボタンは syncDock() が自動で隠す。難易度（level）も持たないので★も出ない。
  ※ 一覧の読み出し（list / load）だけはログインしていなくても通る。公開された内容しか返さないため。
     公開・取り消し・削除依頼・管理は POST ＋ CSRFトークン ＋ ログインが要る。
*/
import { ST } from './state.js';
import { tt } from './util.js';
import { toast, openDockModal, closeDockModal, setFabLed } from './dom.js';
import { isSignedIn, isAdminUser, getCsrf, setSaveWatcher } from './account.js';
import { unpackScore, refreshUploads } from './uploads.js';
import { setScore, syncDock } from './modes.js';
import { setTempo, stopPlay } from './audio/scheduler.js';
import { closeDrawer } from './drawer.js';
import { setMidiFile, renderTracks, setShared, renderSongList, SONGS_PER_PAGE } from './songs.js';
/* 採点ゲームの課題曲一覧にも共有された曲を並べるので、取り直したら作り直す */
import { renderGameSongs } from './game.js';

const API  = new URL('../api/shares.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';

/* 一覧はサーバが50件ずつ返す。画面では「用意した曲」と混ぜて並べ替えるので、
   ここでは何回かに分けて全部もらっておく。際限なく取りに行かないよう上限を決めてある。 */
const FETCH_MAX_PAGES = 10;

let busy      = false;
let shareId   = 0;     /* #mShare で公開しようとしている scores の1件 */
let admPage   = 1;     /* 管理の一覧のページ（1始まり） */
let admQuery  = '';
let admTotal  = 0;
let admItems  = [];

/* ===== 通信 =====
   読み出し（list / load）は GET。公開された内容しか返さないので、
   ログインしていない人にも見せる必要がある（曲一覧は誰でも開ける画面のため）。 */
async function get(action, data = {}) {
  const q = new URLSearchParams(Object.assign({ action, lang: LANG }, data));
  const res = await fetch(API + '?' + q.toString(), {
    method: 'GET',
    headers: { 'X-Requested-With': 'fetch' },
    credentials: 'same-origin', cache: 'no-store',
  });
  return res.json();
}
/* 状態が変わる操作（share / unshare / report / admin）。
   api/account.php・api/scores.php と同じ作法（POST ＋ X-Requested-With ＋ CSRFトークン）。 */
async function post(action, data = {}) {
  const body = new URLSearchParams(Object.assign({ action, lang: LANG, csrf: getCsrf() }, data));
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'fetch' },
    body, credentials: 'same-origin', cache: 'no-store',
  });
  return res.json();
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ===== 一覧を取り直す =====
   取れなかったときは共有ぶんを空にするだけ。あらかじめ用意した曲の一覧は出たままにする
   （この機能が落ちても「曲を練習する」は止まらない）。 */
export async function refreshShares() {
  let all = [];
  try {
    for (let page = 1; page <= FETCH_MAX_PAGES; page++) {
      const r = await get('list', { page: page });
      if (!r || !r.ok || !Array.isArray(r.items)) break;
      all = all.concat(r.items);
      if (r.items.length < (r.per || SONGS_PER_PAGE)) break;
      if (all.length >= (r.total || all.length)) break;
    }
  } catch (e) { all = []; }
  setShared(all);
  renderSongList();
  renderGameSongs();      /* 採点ゲームの課題曲一覧にも同じものを並べる */
}

/* ===== 一覧から開く ===== */
export async function loadShared(id, quiet) {
  if (busy || !id) return;
  busy = true;
  /* 再生中に別の曲を選んだ＝いま鳴っている曲は止めてから読み込む */
  if (ST.playing) stopPlay();
  try {
    const r = await get('load', { id: id });
    if (!r || !r.ok) { toast(tt('share.err', (r && r.message) || '')); return; }

    /* 共有された曲は MIDI の元ファイルを持たない＝トラック選択の面は出さない */
    setMidiFile(null); renderTracks();

    const parsed = unpackScore(r.data || {});
    setTempo(Math.round((r.data && r.data.tempo) || ST.tempo));
    /* 運指の保存キーは件ごとに固定（'share:12'）。画面に出す名前は投稿された曲名 */
    setScore(parsed, 'share:' + r.id, r.name);
    /* 伴奏コードは預かっていないので入れ直さない＝伴奏ボタンは syncDock が隠す */
    syncDock();
    /* ドロワーが閉じて指板だけになるので、次に押す ▶ を光らせて示す */
    if (!quiet) { closeDrawer(); setFabLed(); toast(tt('share.loaded', r.name)); }
  } catch (e) {
    toast(tt('share.err', e.message));
  } finally {
    busy = false;
  }
}

/* ===== 公開する（#mShare） ===== */
function setMsg(text, isErr) {
  const el = document.getElementById('shMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}
/* 公開するときの曲名は、アップロードした楽譜に付いている名前をそのまま使う
   （#mShare の名前入力欄は廃止した。付け替えたいときは一覧の「名前」から変える）。 */
export function openShare(id) {
  if (!id) return;
  if (!isSignedIn()) { toast(tt('share.need_login')); return; }
  shareId = Number(id) || 0;
  const ag = document.getElementById('shAgree');
  if (ag) ag.checked = false;            /* 同意は開くたびに入れ直してもらう */
  setMsg('');
  openDockModal('mShare');
}
export async function doShare() {
  if (busy || !shareId) return;
  if (!isSignedIn()) { setMsg(tt('share.need_login'), true); return; }
  const ag = document.getElementById('shAgree');
  /* 同意が入っていなければ送らない（サーバ側でも agree を見ている＝二重に確かめる） */
  if (!ag || !ag.checked) { setMsg(tt('acc.err.agree'), true); return; }
  busy = true; setMsg('');
  try {
    /* 曲名は送らない＝サーバ側がアップロードした楽譜の名前をそのまま使う */
    const r = await post('share', { id: shareId, agree: '1' });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('acc.err.server'), true); return; }
    shareId = 0;
    closeDockModal();
    await refreshShares();
    await refreshUploads();   /* 指板の「非公開/公開中」を今の状態に合わせる */
    toast(r.message || '');
  } catch (e) {
    setMsg(tt('acc.err.offline'), true);
  } finally {
    busy = false;
  }
}

/* ===== 公開をやめる（自分の投稿にだけ出る） ===== */
export async function unshareSong(id) {
  if (busy || !id || !isSignedIn()) return;
  if (!window.confirm(tt('share.ask_unshare'))) return;
  busy = true;
  try {
    const r = await post('unshare', { id: id });
    if (!r || !r.ok) { toast(tt('share.err', (r && r.message) || '')); return; }
    await refreshShares();
    await refreshUploads();   /* 指板の「非公開/公開中」を今の状態に合わせる */
    toast(r.message || '');
  } catch (e) {
    toast(tt('share.err', e.message));
  } finally {
    busy = false;
  }
}

/* ===== 削除依頼 =====
   受け付けた時点でサーバ側が非公開にする＝運営が見るまで一覧から消える。 */
export async function reportShare(id) {
  if (busy || !id) return;
  if (!isSignedIn()) { toast(tt('share.need_login')); return; }
  if (!window.confirm(tt('share.ask_report'))) return;
  busy = true;
  try {
    const r = await post('report', { id: id });
    if (!r || !r.ok) { toast(tt('share.err', (r && r.message) || '')); return; }
    await refreshShares();
    toast(r.message || '');
  } catch (e) {
    toast(tt('share.err', e.message));
  } finally {
    busy = false;
  }
}

/* ===== 管理（config/app.php の admin_email だけ） =====
   歯車の一覧に出す行の出し入れは src/account.js（USER.admin）。
   ここは中身を作るだけ。見えていてもサーバ側で必ず管理者か確かめている。 */
export function openAdmin() {
  admPage = 1;
  const el = document.getElementById('admQ');
  if (el) el.value = admQuery;
  refreshAdmin();
}
export function setAdminQuery(q) {
  admQuery = String(q || '');
  admPage = 1;
  refreshAdmin();
}
export function setAdminPage(p) {
  const n = parseInt(p, 10);
  admPage = (isFinite(n) && n > 0) ? n : 1;
  refreshAdmin();
}
/* いま見せているページ（ページ送りの配線が ±1 するために見る） */
export function adminListPage() { return admPage; }

export async function refreshAdmin() {
  if (!isAdminUser()) return;
  try {
    const r = await post('admin', { sub: 'list', q: admQuery, page: admPage });
    if (!r || !r.ok) { admItems = []; admTotal = 0; }
    else { admItems = Array.isArray(r.items) ? r.items : []; admTotal = r.total || 0; }
  } catch (e) { admItems = []; admTotal = 0; }
  renderAdmin();
}

function renderAdmin() {
  const box = document.getElementById('admList');
  if (!box) return;
  if (!admItems.length) {
    box.innerHTML = '<div class="upempty">' + esc(tt('share.admin_none')) + '</div>';
  } else {
    box.innerHTML = admItems.map(it => {
      const pub  = (it.status === 'public');
      const st   = tt(pub ? 'share.admin_public' : 'share.admin_hidden');
      const rep  = it.reports ? tt('share.admin_reports', it.reports) : '';
      const sub  = st + (it.sub ? ' · ' + it.sub : '') + rep;
      return '<div class="uprow" data-id="' + it.id + '">'
        + '<span class="un">' + esc(it.name) + '<small>' + esc(sub) + '</small></span>'
        + '<span class="ub">'
        +   '<button type="button" class="ubtn ut" data-adm="' + (pub ? 'hide' : 'show') + '" data-id="' + it.id + '">'
        +     esc(tt(pub ? 'share.admin_hide' : 'share.admin_show')) + '</button>'
        +   '<button type="button" class="ubtn ud" data-adm="delete" data-id="' + it.id + '">'
        +     esc(tt('share.admin_delete')) + '</button>'
        + '</span>'
        + '</div>';
    }).join('');
  }
  /* ページ送り（曲一覧と同じ作り）。1ページに収まっているあいだは出さない */
  const pg = document.getElementById('admPager');
  if (!pg) return;
  const pages = Math.max(1, Math.ceil(admTotal / SONGS_PER_PAGE));
  if (pages <= 1) { pg.hidden = true; pg.innerHTML = ''; return; }
  pg.hidden = false;
  pg.innerHTML = '<button type="button" class="pgb" data-admpg="prev"' + (admPage <= 1 ? ' disabled' : '') + '>' + esc(tt('share.prev')) + '</button>'
    + '<span class="pgi">' + esc(tt('share.page', admPage, pages)) + '</span>'
    + '<button type="button" class="pgb" data-admpg="next"' + (admPage >= pages ? ' disabled' : '') + '>' + esc(tt('share.next')) + '</button>';
}

/* 管理の1行の操作。sub は 'show' / 'hide' / 'delete' */
export async function adminAction(id, sub) {
  if (busy || !isAdminUser() || !id) return;
  if (sub === 'delete' && !window.confirm(tt('share.ask_delete'))) return;
  busy = true;
  try {
    const r = await post('admin', { sub: sub, id: id });
    if (!r || !r.ok) { toast(tt('share.err', (r && r.message) || '')); return; }
    await refreshAdmin();
    await refreshShares();      /* 曲一覧にも効くので作り直す */
  } catch (e) {
    toast(tt('share.err', e.message));
  } finally {
    busy = false;
  }
}

/* 起動時：ログイン状態が決まるたびに一覧を取り直す（src/uploads.js と同じ作法）。
   ログインしていなくても一覧は出る（公開された内容だから）。
   取り直すのは、自分の投稿かどうか＝「公開をやめる」を出すかが変わるため。 */
let lastWho;
export function initShares() {
  setSaveWatcher(function (who) {
    /* 画面を開き直しただけでは取り直さない（account.js の syncUI は何度も呼ばれる）。
       ログイン・ログアウトでほんとうに人が変わったときだけ取り直す。 */
    if (who === lastWho) return;
    lastWho = who;
    refreshShares();
  });
}
