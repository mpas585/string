/*
  account.js — 保存番号（英字1文字＋数字4桁）で設定を保存/復元するフロント側。
  サーバは api/auth.php（実処理は includes/auth.php・保存は SQLite）。

  ログインではなく「保存」。ユーザーはアカウントを管理する意識を持たず、
  「この端末に自分の設定を置いている」という感覚で使う。
    ・初回は保存番号を持たないまま全機能を使える
    ・保存が要る操作（テンポ・指番号・運指・その他の設定）で初めて作成を尋ねる
    ・番号を持っていれば、以後の変更は確認なしで即上書き（右下に「✓ 保存しました」）
    ・同じ端末では LocalStorage の番号で起動時に自動復元（入力不要）
    ・他の端末では番号を打つだけで現在の設定を置き換える

  画面は #mSave（設定画面）と #mSaveAsk（保存しますか？）。要素IDはアプリ本体と
  楽器選択トップで同じにしてあるので、このファイルを両方でそのまま共用している。

  ※ 預けるのは localStorage の 'cf:' で始まるキー（設定・運指）そのもの。
     drawer.js の Store と同じ場所を読むので、保存する項目を増やしても手を入れなくてよい。
     localStorage が使えない環境（プライベートモード等）ではこの機能だけ黙って止まる。
*/
import { tt } from './util.js';
import { toast, openDockModal, closeDockModal } from './dom.js';

const API  = new URL('../api/auth.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';
const $ = (id) => document.getElementById(id);

const K_CODE    = 'cf:save:code';   /* 保存番号の置き場（これ自体は預けない） */
const PREFIX    = 'cf:';            /* 預ける対象のキー */
const SELF      = 'cf:save:';       /* 保存番号まわりは対象外 */
const MAX_BYTES = 512000;           /* サーバ側 SAVE_MAX_BYTES と合わせる */
const SAVE_WAIT = 600;              /* 変更が続いたときにまとめる待ち時間（ms） */

let CODE     = null;    /* 保存番号。無ければ null */
let armed    = false;   /* 初期化が済むまで自動保存しない */
let applying = false;   /* 復元中の保存を止める */
let asked    = false;   /* この訪問で「保存しますか？」を出したか */
let busy     = false;
let timer    = 0;
let onApplied = null;   /* 復元後に画面を作り直す処理（アプリ本体だけが登録する） */

/* ===== localStorage（使えない環境では機能ごと止める） ===== */
const LS = (() => {
  try { localStorage.setItem('__cf_s', '1'); localStorage.removeItem('__cf_s'); return localStorage; }
  catch (e) { return null; }
})();
function lsGet(k){ try { return LS ? LS.getItem(k) : null; } catch(e){ return null; } }
function lsSet(k, v){ try { if (LS) LS.setItem(k, v); } catch(e){} }
function lsDel(k){ try { if (LS) LS.removeItem(k); } catch(e){} }

/* ===== 通信 ===== */
async function call(action, data = {}) {
  const body = new URLSearchParams(Object.assign({ action, lang: LANG }, data));
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'fetch' },
    body, credentials: 'same-origin', cache: 'no-store',
  });
  return res.json();
}

/* ===== 預けるデータ ===== */
/* 'cf:' で始まるキーをそのまま集める（設定・楽器別の運指を一括で持ち運べる） */
function collect() {
  const keys = {};
  if (!LS) return { v: 1, keys };
  try {
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (!k || k.indexOf(PREFIX) !== 0 || k.indexOf(SELF) === 0) continue;
      keys[k] = LS.getItem(k);
    }
  } catch (e) {}
  return { v: 1, keys };
}
/* 他端末から読み込んだときは「置換」する（混ざると設定の出所が分からなくなるため） */
function applyPayload(p) {
  if (!LS || !p || p.v !== 1 || !p.keys || typeof p.keys !== 'object') return false;
  try {
    const drop = [];
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (k && k.indexOf(PREFIX) === 0 && k.indexOf(SELF) !== 0) drop.push(k);
    }
    drop.forEach(k => LS.removeItem(k));
    for (const k of Object.keys(p.keys)) {
      const v = p.keys[k];
      if (k.indexOf(PREFIX) === 0 && k.indexOf(SELF) !== 0 && typeof v === 'string') LS.setItem(k, v);
    }
  } catch (e) { return false; }
  return true;
}
/* 復元を画面に反映する。反映の中身はアプリ本体だけが知っているので外から渡す */
function repaint() {
  if (!onApplied) return;
  applying = true;
  try { onApplied(); } catch (e) { console.warn('[string] 設定の復元に失敗しました', e); }
  applying = false;
}

/* ===== 表示 ===== */
function syncUI() {
  const who = $('svWho'), btn = $('svBtn');
  if (who) {
    who.textContent = CODE ? tt('ui.save_on', CODE) : tt('ui.save_none');
    who.classList.toggle('on', !!CODE);
  }
  if (btn) btn.textContent = tt(CODE ? 'ui.save_open' : 'ui.save_start');
  const cd = $('svCode');   if (cd) cd.textContent = CODE || '';
  const b1 = $('svBound');  if (b1) b1.hidden = !CODE;
  const b2 = $('svBound2'); if (b2) b2.hidden = !CODE;
  const ub = $('svUnbound');if (ub) ub.hidden = !!CODE;
}

function setMsg(text, isErr) {
  const el = $('svMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}

/* 右下に「✓ 保存しました」を1秒ほど。要素はここで作る（ビューに置かせない） */
function flashSaved() {
  let el = $('svSaved');
  if (!el) {
    el = document.createElement('div');
    el.id = 'svSaved';
    el.className = 'svsaved';
    document.body.appendChild(el);
  }
  el.textContent = tt('save.saved');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1100);
}

function showLoadBox(on) {
  const box = $('svLoadBox');
  if (box) box.hidden = !on;
  if (on) { const i = $('svInput'); if (i) setTimeout(() => i.focus(), 60); }
}

/* ===== 自動保存 ===== */
function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!CODE) return;
    const s = JSON.stringify(collect());
    if (s.length > MAX_BYTES) { toast(tt('save.err.payload')); return; }
    try {
      const r = await call('save', { code: CODE, payload: s });
      if (r && r.ok) { flashSaved(); return; }
      /* 他の端末で消された場合。番号だけ外して未登録の状態に戻す */
      if (r && r.error === 'notfound') { CODE = null; lsDel(K_CODE); syncUI(); }
    } catch (e) { /* 通信できないときは次の変更でまた試す */ }
  }, SAVE_WAIT);
}

/* 設定・運指が変わったときに drawer.js から呼ばれる入口 */
export function settingsChanged() {
  if (!armed || applying) return;
  if (CODE) { scheduleSave(); return; }
  if (asked || !LS) return;
  asked = true;                      /* 尋ねるのは1回だけ。断られたらこの訪問では出さない */
  openDockModal('mSaveAsk');
}

/* 初期化が済んだ合図。これより前の保存（音量の底上げ等）では尋ねない */
export function armSave() { armed = true; }

/* 復元後に画面を作り直す処理を登録する（アプリ本体のみ） */
export function setSaveApply(fn) { onApplied = fn; }

/* ===== 操作（配線は main.js / home.js） ===== */
export function openSave() {
  setMsg('');
  showLoadBox(false);
  const i = $('svInput'); if (i) i.value = '';
  syncUI();
  openDockModal('mSave');
}

export function toggleSaveLoad() {
  const box = $('svLoadBox');
  showLoadBox(box ? box.hidden : true);
}

export async function createSave() {
  if (busy) return;
  if (!LS) { setMsg(tt('save.err.nostore'), true); return; }
  busy = true;
  setMsg('');
  try {
    const s = JSON.stringify(collect());
    if (s.length > MAX_BYTES) { setMsg(tt('save.err.payload'), true); return; }
    const r = await call('create', { payload: s });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('save.err.server'), true); return; }
    CODE = r.code;
    lsSet(K_CODE, CODE);
    syncUI();
    showLoadBox(false);
    openDockModal('mSave');          /* 発行した番号をそのまま見せる */
    toast(r.message || '');
  } catch (e) {
    setMsg(tt('save.err.offline'), true);
  } finally {
    busy = false;
  }
}

export async function loadSave() {
  if (busy) return;
  if (!LS) { setMsg(tt('save.err.nostore'), true); return; }
  const raw = ($('svInput') ? $('svInput').value : '').trim();
  /* サーバでも同じ検証をしているが、往復させずに気づけるようにここでも見る */
  const code = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!/^[A-HJKMNP-Z][0-9]{4}$/.test(code)) { setMsg(tt('save.err.code'), true); return; }

  busy = true;
  setMsg('');
  try {
    const r = await call('load', { code });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('save.err.server'), true); return; }
    if (!applyPayload(r.payload)) { setMsg(tt('save.err.nostore'), true); return; }
    CODE = r.code;
    lsSet(K_CODE, CODE);
    repaint();
    syncUI();
    closeDockModal();
    toast(r.message || '');
  } catch (e) {
    setMsg(tt('save.err.offline'), true);
  } finally {
    busy = false;
  }
}

export async function copySaveCode() {
  if (!CODE) return;
  try {
    await navigator.clipboard.writeText(CODE);
    setMsg(tt('save.copied'), false);
  } catch (e) {
    /* クリップボードが使えない環境では選択できる形にして知らせる */
    const el = $('svCode');
    if (el && window.getSelection && document.createRange) {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
    }
    setMsg(tt('save.copy_manual'), true);
  }
}

/* 紐付け解除は LocalStorage を消すだけ。サーバのデータは残す */
export function unlinkSave() {
  CODE = null;
  lsDel(K_CODE);
  asked = true;                      /* 解除した直後に尋ね直さない */
  syncUI();
  closeDockModal();
  toast(tt('save.ok.unlinked'));
}

export async function deleteSave() {
  if (busy || !CODE) return;
  if (!window.confirm(tt('save.delete_ask'))) return;
  busy = true;
  setMsg('');
  try {
    const r = await call('delete', { code: CODE });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('save.err.server'), true); return; }
    CODE = null;
    lsDel(K_CODE);
    asked = true;
    syncUI();
    closeDockModal();
    toast(r.message || '');
  } catch (e) {
    setMsg(tt('save.err.offline'), true);
  } finally {
    busy = false;
  }
}

/* 「設定を保存しますか？」の2つのボタン */
export function askCreate() { closeDockModal(); createSave(); }
export function askSkip()   { closeDockModal(); }

/* 起動時：番号を持っていればサーバから取り出して復元する。通信できなくても画面は動かす */
export async function initSave() {
  CODE = lsGet(K_CODE);
  syncUI();
  if (!CODE) return;
  try {
    const r = await call('load', { code: CODE });
    if (!r || !r.ok) {
      /* 消された番号を握り続けない。それ以外（通信・制限）は次回に持ち越す */
      if (r && (r.error === 'notfound' || r.error === 'code')) { CODE = null; lsDel(K_CODE); syncUI(); }
      return;
    }
    if (applyPayload(r.payload)) repaint();
  } catch (e) { /* オフライン。ローカルの設定のまま使う */ }
}
