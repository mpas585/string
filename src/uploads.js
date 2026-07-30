/*
  uploads.js — 読み込んだ譜面（アップロードした楽譜）を保存番号に紐づけて残す。

  サーバは api/scores.php（実処理は includes/scores.php・保存は SQLite の scores テーブル）。
  保存番号を持っているあいだだけ働く。番号が無ければ一覧に案内を出すだけで、
  譜面の読み込み自体はこれまでどおり動く（＝この機能が落ちても本体は止まらない）。

    譜面を読み込む   … songs.js / omr-import.js が rememberUpload() を呼ぶ
                       MIDI は selectTrack() から呼ばれる＝選んだトラックごとに残る
    一覧に出す       … refreshUploads()（保存番号が変わるたび account.js から呼ばれる）
    一覧から開く     … openUpload()   … サーバから取り出して setScore ＋ 運指を復元
    一覧から消す     … deleteUpload()
    運指を直した     … drawer.js の saveFingering() から知らせが来る（setFingWatcher）

  ※ 預けるのは「音の並び」と「運指」だけ。元のファイル（MusicXML / MIDI / PDF）は預けない。
       data … [開始拍, 長さ, 小節, [midi…], リード番号] の並び。内容の指紋（sig）はこれで作る
       fing … {octave, data:[{l,s,o,f,m}…]}（drawer.js の fingerData() と同じ形）
     運指を data と分けているのは、運指を直しただけで sig が変わらないようにするため
     ＝「同じ譜面か」の判定が運指の編集で揺れない。
  ※ オクターブを一緒に持つのは、運指の off（開放弦からの半音数）が移調後の音で計算されているため。
     開き直すときは保存時のオクターブに戻してから運指を当てる（違うオクターブに当てると音がずれる）。
  ※ 同じ譜面っぽいものがあるときは #mUpDup で「上書き / 新規で追加」を尋ねる。
     サーバが黙って上書きすることはない。内容まで同じ（sig が一致）ときだけ、尋ねずに何もしない。
*/
import { ST } from './state.js';
import { tt, midiName } from './util.js';
import { toast, openDockModal, closeDockModal } from './dom.js';
import { getSaveCode, setSaveWatcher } from './account.js';
import { setScore } from './modes.js';
import { setTempo } from './audio/scheduler.js';
import { closeDrawer, fingerData, applyFingerData, saveFingering, setFingWatcher } from './drawer.js';
import { recommend } from './fingerboard.js';
import { setMidiFile, renderTracks } from './songs.js';

const API  = new URL('../api/scores.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';

export const MAX_ITEMS = 99;        /* サーバ側 SCORE_MAX_ITEMS と合わせる */
const MAX_BYTES = 512000;           /* サーバ側 SCORE_MAX_BYTES と合わせる */

let items    = [];                  /* [{id, name, notes, sig, updated_at}] */
let busy     = false;
let curId    = 0;                   /* いま画面に出ている譜面に対応する id（0＝対応なし） */
let curScore = '';                  /* そのときの ST.scoreName。別の譜面に移ったかを見るために持つ
                                       （一覧から開いた時は 'up:{id}'、ファイルから読んだ時はファイル名。
                                        scoreName だけで判定すると、読み込んだ直後の運指の編集が
                                        サーバへ届かなくなる＝いちばん多い場面を取りこぼす） */
let applying = false;               /* 復元中の運指を送り返さないための目印 */
let pending  = null;                /* #mUpDup で選ぶまで待たせている保存内容 */

/* ===== 通信（保存番号と同じ作法：全て POST ＋ X-Requested-With） ===== */
async function call(action, data = {}) {
  const body = new URLSearchParams(Object.assign({ action, lang: LANG }, data));
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'fetch' },
    body, credentials: 'same-origin', cache: 'no-store',
  });
  return res.json();
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 内容の指紋。drawer.js の scoreSig() と同じ作り（32bit → 36進） */
function sigOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

/* ===== 譜面 ⇄ 保存する形 ===== */
export function packScore(parsed, tempo) {
  return {
    v: 1,
    tempo: Math.round(tempo || ST.tempo),
    beatsPerMeasure: parsed.beatsPerMeasure || 4,
    beatUnit: (parsed.beatUnit > 0) ? parsed.beatUnit : 1,
    events: parsed.events.map(e => [e.onset, e.dur, e.measure, e.pitches.map(p => p.midi), e.leadIdx]),
    measures: (parsed.measures || []).map(m => [m.num, m.start, m.end]),
  };
}
export function unpackScore(j) {
  const evs = (j.events || []).map((a, i) => {
    const pitches = (a[3] || []).map(m => ({ midi: m, name: midiName(m) }));
    return { id: i, measure: a[2], onset: a[0], dur: a[1], pitches,
             leadIdx: Math.min(a[4] || 0, pitches.length - 1), fing: null };
  }).filter(e => e.pitches.length);
  if (!evs.length) throw new Error(tt('msg.no_notes'));
  evs.forEach(e => { e.fing = recommend(e.pitches[e.leadIdx].midi); });
  const measures = (j.measures || []).map(a => ({ num: a[0], start: a[1], end: a[2] }));
  return {
    events: evs, measures,
    beatsPerMeasure: j.beatsPerMeasure || 4,
    beatUnit: (j.beatUnit > 0) ? j.beatUnit : 1,
  };
}
/* いまの運指（と、それを計算したときのオクターブ）。drawer.js の fingerData() をそのまま使う */
function packFing() {
  return JSON.stringify({ v: 1, octave: ST.octave, data: fingerData() });
}

/* ===== 一覧の表示 ===== */
export function renderUploads() {
  const box  = document.getElementById('upList');
  const note = document.getElementById('upNote');
  if (!box) return;

  if (!getSaveCode()) {
    box.innerHTML = '<div class="upempty">' + esc(tt('ui.uploads_need_save')) + '</div>';
    if (note) note.textContent = tt('ui.uploads_note', MAX_ITEMS);
    return;
  }
  if (!items.length) {
    box.innerHTML = '<div class="upempty">' + esc(tt('ui.uploads_none')) + '</div>';
  } else {
    box.innerHTML = items.map(it => {
      const on = (it.id === curId) ? ' on' : '';
      return '<div class="uprow' + on + '" data-id="' + it.id + '">'
        + '<span class="un">' + esc(it.name) + '<small>' + esc(tt('msg.track_count', it.notes)) + '</small></span>'
        + '<button type="button" class="ud" data-id="' + it.id + '">' + esc(tt('ui.uploads_delete')) + '</button>'
        + '</div>';
    }).join('');
  }
  if (note) note.textContent = tt('ui.uploads_count', items.length, MAX_ITEMS);
}

export async function refreshUploads() {
  const code = getSaveCode();
  if (!code) { items = []; curId = 0; curScore = ''; renderUploads(); return; }
  try {
    const r = await call('list', { code });
    items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
  } catch (e) { items = []; }        /* 通信できないときは空のまま。次の機会に取り直す */
  renderUploads();
}

/* ===== 「同じ譜面っぽいもの」を一覧から探す =====
   近いと思う順に見る。見つからなければ null＝尋ねずに新規で追加する。
     1. 名前がそのまま同じもの        … 同じファイル・同じトラックを開き直した
     2. 名前は違うが中身が同じもの    … 同じ譜面を別名で書き出した
     3. 名前も中身も違うが音数が同じ  … 同じ曲を編集したもの、かもしれない
   ※ 3 は取り違えることもあるので、判断は必ず人に返す（黙って上書きはしない）。 */
function findSimilar(name, packed, sig) {
  const nm = String(name || '').trim();
  const byName = items.find(it => it.name === nm);
  if (byName) return byName;
  const bySig = items.find(it => it.sig === sig);
  if (bySig) return bySig;
  const notes = packed.events.length;
  return items.find(it => it.notes === notes) || null;
}

/* ===== 保存（譜面を読み込んだ経路から呼ばれる） ===== */
export async function rememberUpload(name, parsed, tempo) {
  const code = getSaveCode();
  if (!code || !parsed || !parsed.events || !parsed.events.length) return;

  let packed, data;
  try { packed = packScore(parsed, tempo); data = JSON.stringify(packed); }
  catch (e) { return; }
  if (data.length > MAX_BYTES) { toast(tt('msg.up_err', tt('save.err.payload'))); return; }

  const nm  = String(name || '').slice(0, 120);
  const sig = sigOf(data);
  const hit = findSimilar(nm, packed, sig);

  /* 名前も中身も同じ＝ただ開き直しただけ。尋ねず、書き換えもしない（運指もそのまま残す）。
     MIDI のトラックを行き来しても尋ねられないのはこの判定のため。
     以後の運指の編集がこの1件に届くよう、対応だけ付け替える。 */
  if (hit && hit.name === nm && hit.sig === sig) { curId = hit.id; curScore = ST.scoreName; renderUploads(); return; }

  /* 似ているものがある＝上書きか新規追加かを尋ねる（サーバは黙って上書きしない） */
  if (hit) {
    pending = { code: code, nm: nm, sig: sig, data: data, notes: packed.events.length, id: hit.id };
    const body = document.getElementById('upDupBody');
    if (body) body.textContent = tt('ui.up_dup_body', hit.name, nm);
    openDockModal('mUpDup');
    return;
  }

  /* 初めての譜面。読み込みのトーストを上書きしないよう、ここでは黙って保存する */
  await sendUpload({ code: code, nm: nm, sig: sig, data: data, notes: packed.events.length, id: 0 }, true);
}

/* 実際に送る。id>0 なら上書き、0 なら新規追加 */
async function sendUpload(p, quiet) {
  try {
    const r = await call('save', {
      code: p.code, name: p.nm, notes: p.notes, data: p.data, sig: p.sig,
      fing: packFing(), id: p.id || 0,
    });
    if (!r || !r.ok) {
      if (r && r.error === 'limit') toast(tt('msg.up_full', MAX_ITEMS));
      else if (r && r.message)      toast(tt('msg.up_err', r.message));
      return;
    }
    curId = r.id;
    curScore = ST.scoreName;        /* この譜面を見ているあいだの運指の編集は、この1件に送る */
    await refreshUploads();
    if (!quiet) toast(tt(r.mode === 'update' ? 'msg.up_overwritten' : 'msg.up_added', p.nm));
  } catch (e) { /* 通信できないときは黙って諦める（本体の読み込みは済んでいる） */ }
}

/* #mUpDup の2つのボタン（配線は main.js）。✕ で閉じたときは保存しない */
export function upDupOverwrite() {
  const p = pending; pending = null;
  closeDockModal();
  if (p) sendUpload(p);
}
export function upDupAddNew() {
  const p = pending; pending = null;
  closeDockModal();
  if (p) sendUpload(Object.assign({}, p, { id: 0 }));
}
export function upDupCancel() { pending = null; }

/* ===== 一覧から開く ===== */
export async function openUpload(id) {
  const code = getSaveCode();
  if (busy || !code || !id) return;
  busy = true;
  try {
    const r = await call('load', { code, id: id });
    if (!r || !r.ok) { toast(tt('msg.up_err', (r && r.message) || '')); return; }
    const parsed = unpackScore(r.data || {});
    const fing = r.fing;

    setMidiFile(null); renderTracks();          /* 前のMIDIのトラック一覧を残さない */
    /* 運指は保存時のオクターブで計算されているので、setScore（＝applyOctave）より前に戻す */
    if (fing && fing.octave != null) ST.octave = (fing.octave === 'auto') ? 'auto' : (parseInt(fing.octave, 10) || 0);
    setTempo(Math.round((r.data && r.data.tempo) || ST.tempo));
    curId = r.id;
    curScore = 'up:' + r.id;
    setScore(parsed, curScore);                 /* 運指の保存キーは件ごとに固定 */

    /* 保存してあった運指を当てる。当てたぶんは localStorage にも書いて、
       次はオフラインでも同じ運指で開けるようにする（送り返しは applying で止める） */
    if (fing && Array.isArray(fing.data)) {
      applying = true;
      if (applyFingerData(fing.data)) saveFingering();
      applying = false;
    }
    /* オクターブを戻したので、その表示（モーダルのボタン）も合わせる */
    document.querySelectorAll('.oct').forEach(b => b.classList.toggle('on', String(b.dataset.oct) === String(ST.octave)));

    closeDrawer();
    renderUploads();                            /* 選択中の行に印を付け直す */
    toast(tt('msg.up_loaded', r.name));
  } catch (e) {
    toast(tt('msg.up_err', e.message));
  } finally {
    busy = false;
  }
}

/* ===== 一覧から消す ===== */
export async function deleteUpload(id) {
  const code = getSaveCode();
  if (busy || !code || !id) return;
  if (!window.confirm(tt('msg.up_delete_ask'))) return;
  busy = true;
  try {
    const r = await call('delete', { code, id: id });
    if (!r || !r.ok) { toast(tt('msg.up_err', (r && r.message) || '')); return; }
    if (Number(id) === curId) { curId = 0; curScore = ''; }
    await refreshUploads();
    toast(tt('msg.up_deleted'));
  } catch (e) {
    toast(tt('msg.up_err', e.message));
  } finally {
    busy = false;
  }
}

/* ===== 運指を直したとき（drawer.js の saveFingering から） =====
   アップロードした譜面を開いているあいだだけ、その1件の運指を更新する。
   譜面本体は送らないので sig は変わらない＝「同じ譜面か」の判定に影響しない。 */
export async function updateUploadFingering() {
  const code = getSaveCode();
  if (applying || !code || !curId) return;
  if (ST.scoreName !== curScore) return;             /* 別の譜面に移っていたら何もしない */
  try { await call('fing', { code: code, id: curId, fing: packFing() }); }
  catch (e) { /* 通信できないときはローカルの保存だけで済ませる */ }
}

/* 起動時：保存番号が変わるたびに一覧を取り直す（作成・読込・解除・削除・自動復元） */
export function initUploads() {
  setSaveWatcher(function () { refreshUploads(); });
  setFingWatcher(function () { updateUploadFingering(); });
  renderUploads();
}
