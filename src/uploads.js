/*
  uploads.js — 読み込んだ譜面（アップロードした楽譜）をアカウントに紐づけて残す。

  サーバは api/scores.php（実処理は includes/scores.php・保存は SQLite の scores テーブル）。
  ログインしているあいだだけ働く。していなければ一覧に案内を出すだけで、
  譜面の読み込み自体はこれまでどおり動く（＝この機能が落ちても本体は止まらない）。

    譜面を読み込む   … songs.js が beginUpload(ファイル名) → rememberUpload() を呼ぶ
                       【1ファイル＝1件】。MIDI のトラックを選び直しても件数は増えず、
                       同じ1件が書き換わる（どのトラックを選んでいたかは sub に持つ）
    一覧に出す       … refreshUploads()（ログイン状態が変わるたび account.js から呼ばれる）
    一覧から開く     … openUpload()   … サーバから取り出して setScore ＋ 運指を復元
    一覧から消す     … deleteUpload()
    運指を直した     … drawer.js の saveFingering() から知らせが来る（setFingWatcher）

  ※ 預けるのは「音の並び」と「運指」だけ。元のファイル（MusicXML / MIDI / PDF）は預けない。
       data … [開始拍, 長さ, 小節, [midi…], リード番号] の並び。内容の指紋（sig）はこれで作る
       fing … {octave, data:[{l,s,o,f,m}…]}（drawer.js の fingerData() と同じ形）。
              運指は弦とポジションの番号なので楽器が変わると別の音を指す。そこで通信のたびに
              楽器名（inst）を添え、サーバ側で楽器ごとに分けて持つ（includes/scores.php）。
              画面から見えるのは「いまの楽器の運指」だけなので、この形は従来のまま。
              譜面そのものは楽器で分けない＝一覧はどの楽器から見ても同じものが出る。
       src  … MIDI のときだけ元ファイル（base64）。一覧から開き直したあとに
              トラックを選び直せるようにするため。MusicXML では預けない
     運指を data と分けているのは、運指を直しただけで sig が変わらないようにするため
     ＝「同じ譜面か」の判定が運指の編集で揺れない。
  ※ オクターブを一緒に持つのは、運指の off（開放弦からの半音数）が移調後の音で計算されているため。
     開き直すときは保存時のオクターブに戻してから運指を当てる（違うオクターブに当てると音がずれる）。
  ※ 同じ譜面っぽいものがあるときは #mUpDup で「上書き / 新規で追加」を尋ねる。
     サーバが黙って上書きすることはない。内容まで同じ（sig が一致）ときだけ、尋ねずに何もしない。
*/
import { ST } from './state.js';
import { tt, midiName, INSTRUMENT_ID } from './util.js';
import { toast, openDockModal, closeDockModal } from './dom.js';
import { isSignedIn, isAdminUser, getCsrf, setSaveWatcher } from './account.js';
import { setScore, renderScoreTitle } from './modes.js';
import { setTempo, stopPlay } from './audio/scheduler.js';
import { closeDrawer, fingerData, applyFingerData, saveFingering, setFingWatcher, setScoreSub } from './drawer.js';
import { isFav } from './favorites.js';
import { recommend } from './fingerboard.js';
import { setMidiFile, renderTracks, parseMidi, base64ToBytes } from './songs.js';
import { buildMidi, buildMusicXML, downloadBlob, safeName } from './export.js';

const API  = new URL('../api/scores.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';

export const MAX_ITEMS = 3;        /* サーバ側 SCORE_MAX_ITEMS と合わせる */
export const MAX_ITEMS_ADMIN = 999; /* サーバ側 SCORE_MAX_ITEMS_ADMIN と合わせる（管理者だけ） */
/* いまログインしている人が持てる件数。判定はサーバ側（includes/scores.php の score_max_items）が本体で、
   ここは案内の数字を合わせるためだけに見ている */
function maxItems() { return isAdminUser() ? MAX_ITEMS_ADMIN : MAX_ITEMS; }
const MAX_BYTES = 512000;           /* サーバ側 SCORE_MAX_BYTES と合わせる */

let items    = [];                  /* [{id, name, sub, notes, sig, hassrc, shared, share_id, updated_at}] */
/* いま進行中の読み込み操作。MIDI のトラックを選び直したときに、新しい行を作らず
   同じ1件を書き換えるために持つ（beginUpload でファイルごとに引き直す）。 */
let session  = { name: '', id: 0 };
let busy     = false;
let curId    = 0;                   /* いま画面に出ている譜面に対応する id（0＝対応なし） */
let curScore = '';                  /* そのときの ST.scoreName。別の譜面に移ったかを見るために持つ
                                       （一覧から開いた時は 'up:{id}'、ファイルから読んだ時はファイル名。
                                        scoreName だけで判定すると、読み込んだ直後の運指の編集が
                                        サーバへ届かなくなる＝いちばん多い場面を取りこぼす） */
let applying = false;               /* 復元中の運指を送り返さないための目印 */
let pending  = null;                /* #mUpDup で選ぶまで待たせている保存内容 */

/* ===== 通信（アカウントと同じ作法：全て POST ＋ X-Requested-With ＋ CSRFトークン） =====
   誰の譜面かはサーバがセッションから決める（画面から保存番号を送っていた旧版とは違う）。 */
async function call(action, data = {}) {
  const body = new URLSearchParams(Object.assign({ action, lang: LANG, inst: INSTRUMENT_ID, csrf: getCsrf() }, data));
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
export function packScore(parsed, tempo, meta) {
  return {
    v: 1,
    tempo: Math.round(tempo || ST.tempo),
    /* MIDI のときは選んでいたトラック（番号と名前）。開き直したときにこれを見せる */
    track: (meta && meta.track != null) ? meta.track : null,
    trackName: (meta && meta.trackName) ? String(meta.trackName) : '',
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

  if (!isSignedIn()) {
    box.innerHTML = '<div class="upempty">' + esc(tt('ui.uploads_need_save')) + '</div>';
    if (note) note.textContent = tt('ui.uploads_note', maxItems());
    return;
  }
  if (!items.length) {
    box.innerHTML = '<div class="upempty">' + esc(tt('ui.uploads_none')) + '</div>';
  } else {
    box.innerHTML = items.map(it => {
      const on = (it.id === curId) ? ' on' : '';
      const sub = tt('msg.track_count', it.notes) + (it.sub ? ' · ' + it.sub : '');
      /* 元のMIDIを預かっている行だけ、トラックを選び直せる */
      const trk = it.hassrc
        ? '<button type="button" class="ubtn ut" data-id="' + it.id + '">' + esc(tt('ui.uploads_tracks')) + '</button>'
        : '';
      /* ダウンロード（トラックの左）。MIDI / MusicXML はこのあと小窓で選ぶ。
         元のMIDIを預かっていない行（MusicXMLから読んだもの）にも出す＝
         書き出しは預かっている「音の並び」から作るため、元ファイルは要らない。 */
      const dl = '<button type="button" class="ubtn ud" data-id="' + it.id + '"'
               + ' data-name="' + esc(it.name) + '" aria-label="' + esc(tt('ui.download')) + '"'
               + ' title="' + esc(tt('ui.download')) + '">\u2913</button>';
      /* 見た目は「曲を選ぶ」の .songbtn とそろえる（同じ「曲を開く」ための一覧なので）。
         中に［トラック］ボタンを入れる都合で button の入れ子にできないため、
         div に .songbtn を併せ持たせて同じ CSS を当てている。
         行に残す操作は「トラック」だけ（元のMIDIを預かっている行のみ）。名前の変更は
         上部バーの曲名から、シェアと削除は指板の左上・右上へ移した。 */
      const fav = isFav('up:' + it.id)
        ? '<span class="fav" aria-hidden="true">\u2764</span>' : '';
      const fc  = isFav('up:' + it.id) ? ' hasfav' : '';
      return '<div class="uprow songbtn' + fc + on + '" data-id="' + it.id + '">'
        + esc(it.name) + '<small>' + esc(sub) + '</small>'
        + fav
        + '<span class="ub">' + dl + trk + '</span>'
        + '</div>';
    }).join('');
  }
  if (note) note.textContent = tt('ui.uploads_count', items.length, maxItems());
}

export async function refreshUploads() {
  if (!isSignedIn()) { items = []; curId = 0; curScore = ''; session = { name: '', id: 0 }; renderUploads(); return; }
  try {
    const r = await call('list');
    items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
  } catch (e) { items = []; }        /* 通信できないときは空のまま。次の機会に取り直す */
  renderUploads();
  syncShareDeleteBtns();
}

/* ===== 指運ビューの「公開/非公開」「削除」ボタン（右上・左上）用 =====
   いま画面に出ている譜面が自分のアップロードのどれかに対応するときだけ、
   items の中からその1件を返す（対応しなければ null＝ボタンは隠す）。 */
export function curUploadItem() {
  if (!curId || !curScore) return null;
  /* 別の曲（用意した曲・みんなの曲・読み込んだだけのファイル）に移っていたら対象外。
     curId は開き直すまで残るので、いま出ている譜面と一致するかを必ず見る。
     譜面を閉じると ST.scoreName は '' になる。curScore も空なら両方 '' で一致してしまい、
     何も開いていないのにボタンが出てしまうため、空でないことを先に確かめる。 */
  if (!ST.scoreName || ST.scoreName !== curScore) return null;
  return items.find(it => it.id === curId) || null;
}

/* 指板の左上「公開/非公開」（ハートの上）と右上「削除」ボタン。
   曲が変わるたび（src/modes.js の setScore）と、一覧を取り直すたびに呼ぶ。 */
export function syncShareDeleteBtns() {
  const it = curUploadItem();
  const sb = document.getElementById('shareBtn');
  const db = document.getElementById('delBtn');
  if (sb) {
    if (!it || !isSignedIn()) {
      sb.hidden = true;
    } else {
      sb.hidden = false;
      const on = !!it.shared;
      sb.classList.toggle('on', on);
      sb.setAttribute('aria-pressed', on ? 'true' : 'false');
      sb.setAttribute('aria-label', tt(on ? 'ui.share_btn_public' : 'ui.share_btn_private'));
      const t = sb.querySelector('.sb-t');
      if (t) t.textContent = tt(on ? 'ui.share_btn_public' : 'ui.share_btn_private');
    }
  }
  if (db) {
    if (!it || !isSignedIn()) { db.hidden = true; }
    else { db.hidden = false; db.dataset.id = String(it.id); }
  }
  /* 上部バーの曲名。自分の譜面のときだけ押せるようにして、その場で名前を変えられる */
  const tb = document.getElementById('scoretitle');
  if (tb) {
    const own = !!it && isSignedIn();
    tb.disabled = !own;
    tb.classList.toggle('editable', own);
    if (own) {
      tb.dataset.id = String(it.id);
      tb.dataset.name = it.name;
      tb.setAttribute('title', tt('share.m_rename'));
    } else {
      delete tb.dataset.id; delete tb.dataset.name;
      tb.removeAttribute('title');
    }
  }
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

/* ファイルを1つ読み込み始めた合図。ここから先の rememberUpload は同じ1件として扱う
   （MIDI のトラックを選び直しても行が増えないのはこのため）。 */
export function beginUpload(name) {
  session = { name: String(name || ''), id: 0 };
}

/* ===== 保存（譜面を読み込んだ経路から呼ばれる） ===== */
export async function rememberUpload(name, parsed, tempo, meta) {
  if (!isSignedIn() || !parsed || !parsed.events || !parsed.events.length) return;

  let packed, data;
  try { packed = packScore(parsed, tempo, meta); data = JSON.stringify(packed); }
  catch (e) { return; }
  if (data.length > MAX_BYTES) { toast(tt('msg.up_err', tt('acc.err.payload'))); return; }

  const nm  = String(name || '').slice(0, 120);
  const sub = (meta && meta.trackName) ? String(meta.trackName) : '';
  const sig = sigOf(data);

  /* 元のMIDI。同じ読み込み操作の続き（トラックを選び直した）では送らない
     ＝サーバ側は既存のまま。毎回数十KBを送り直さないため。 */
  const src = (meta && meta.src) ? meta.src : null;

  /* 同じ読み込み操作の続き（MIDI のトラックを選び直した）＝尋ねずに同じ1件を書き換える */
  if (session.name === nm && session.id) {
    await sendUpload({ nm: nm, sub: sub, sig: sig, data: data, notes: packed.events.length, id: session.id, src: null }, true);
    return;
  }

  const hit = findSimilar(nm, packed, sig);

  /* 名前も中身も同じ＝ただ開き直しただけ。尋ねず、書き換えもしない（運指もそのまま残す）。
     MIDI のトラックを行き来しても尋ねられないのはこの判定のため。
     以後の運指の編集がこの1件に届くよう、対応だけ付け替える。 */
  if (hit && hit.name === nm && hit.sig === sig) {
    curId = hit.id; curScore = ST.scoreName;
    if (session.name === nm) session.id = hit.id;
    renderUploads();
    return;
  }

  /* 似ているものがある＝上書きか新規追加かを尋ねる（サーバは黙って上書きしない） */
  if (hit) {
    pending = { nm: nm, sub: sub, sig: sig, data: data, notes: packed.events.length, id: hit.id, src: src };
    const body = document.getElementById('upDupBody');
    if (body) body.textContent = tt('ui.up_dup_body', hit.name, nm);
    openDockModal('mUpDup');
    return;
  }

  /* 初めての譜面。読み込みのトーストを上書きしないよう、ここでは黙って保存する */
  await sendUpload({ nm: nm, sub: sub, sig: sig, data: data, notes: packed.events.length, id: 0, src: src }, true);
}

/* 実際に送る。id>0 なら上書き、0 なら新規追加 */
async function sendUpload(p, quiet) {
  try {
    const body = {
      name: p.nm, sub: p.sub || '', notes: p.notes, data: p.data, sig: p.sig,
      fing: packFing(), id: p.id || 0,
    };
    /* src は入れたときだけ送る。入れなければサーバ側は既存のまま（触らない） */
    if (p.src != null) body.src = p.src;
    const r = await call('save', body);
    if (!r || !r.ok) {
      if (r && r.error === 'limit') toast(tt('msg.up_full', maxItems()));
      else if (r && r.message)      toast(tt('msg.up_err', r.message));
      return;
    }
    curId = r.id;
    curScore = ST.scoreName;        /* この譜面を見ているあいだの運指の編集は、この1件に送る */
    if (session.name === p.nm) session.id = r.id;   /* 以後のトラック選び直しは同じ1件へ */
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
/* showTracks = true のとき（一覧の「トラック」を押したとき）は、閉じずにトラック選択の面を出す */
export async function openUpload(id, showTracks) {
  if (busy || !isSignedIn() || !id) return;
  busy = true;
  /* 再生中に別の譜面を選んだ＝いま鳴っている曲は止めてから読み込む */
  if (ST.playing) stopPlay();
  try {
    const r = await call('load', { id: id });
    if (!r || !r.ok) { toast(tt('msg.up_err', (r && r.message) || '')); return; }
    const parsed = unpackScore(r.data || {});
    const fing = r.fing;

    /* 元のMIDIを預かっていれば、トラック一覧を作り直して選び直せるようにする。
       壊れていても譜面は開けるようにしたいので、失敗しても止めない。 */
    let midi = null;
    if (r.src) {
      try {
        const m = parseMidi(base64ToBytes(r.src).buffer);
        const trk = (r.data && r.data.track != null) ? r.data.track : 0;
        midi = { tracks: m.tracks, tempo: m.tempo, tsNum: m.tsNum, tsDen: m.tsDen,
                 division: m.division, name: r.name, sel: Math.min(trk, m.tracks.length - 1), src: r.src };
      } catch (e) { midi = null; }
    }
    setMidiFile(midi); renderTracks();
    /* この1件を開いた状態にしておく＝以後トラックを選び直しても、尋ねずに同じ1件が書き換わる */
    session = { name: r.name, id: r.id };
    /* 運指は保存時のオクターブで計算されているので、setScore（＝applyOctave）より前に戻す */
    if (fing && fing.octave != null) ST.octave = (fing.octave === 'auto') ? 'auto' : (parseInt(fing.octave, 10) || 0);
    setTempo(Math.round((r.data && r.data.tempo) || ST.tempo));
    curId = r.id;
    curScore = 'up:' + r.id;
    /* 第3引数＝上部バーに出す表示名。curScore は 'up:12' という内部IDなので、
       これを渡さないと曲名の欄が空のままになる。 */
    setScore(parsed, curScore, r.name);         /* 運指の保存キーは件ごとに固定 */

    /* 保存してあった運指を当てる。当てたぶんは localStorage にも書いて、
       次はオフラインでも同じ運指で開けるようにする（送り返しは applying で止める） */
    if (fing && Array.isArray(fing.data)) {
      applying = true;
      if (applyFingerData(fing.data)) saveFingering();
      applying = false;
    }
    /* オクターブを戻したので、その表示（モーダルのボタン）も合わせる */
    document.querySelectorAll('.oct').forEach(b => b.classList.toggle('on', String(b.dataset.oct) === String(ST.octave)));

    if (showTracks && midi) { setScoreSub('tracks'); }
    else { closeDrawer(); }
    renderUploads();                            /* 選択中の行に印を付け直す */
    toast(tt('msg.up_loaded', r.name));
  } catch (e) {
    toast(tt('msg.up_err', e.message));
  } finally {
    busy = false;
  }
}

/* ===== ダウンロード（#mDownload） =====
   預かっている「音の並び」から MIDI / MusicXML を作って書き出す。
   元のファイルをそのまま返すのではない（MusicXMLは元ファイルを預かっていないため）。
   運指は入れない＝譜面の音の並びだけ。 */
let dlId = 0, dlName = '';
export function openDownload(id, name){
  if(!isSignedIn() || !id) return;
  dlId = Number(id) || 0;
  dlName = String(name || '');
  const t = document.getElementById('dlName');
  if (t) t.textContent = dlName;
  openDockModal('mDownload');
}
export async function doDownload(kind){
  if(busy || !isSignedIn() || !dlId) return;
  busy = true;
  try {
    const r = await call('load', { id: dlId });
    if(!r || !r.ok){ toast(tt('msg.dl_fail', (r && r.message) || '')); return; }
    const score = r.data || {};
    const nm    = safeName(r.name || dlName);
    if(kind === 'midi'){
      downloadBlob(buildMidi(score, r.name || dlName), 'audio/midi', nm + '.mid');
      closeDockModal();
      toast(tt('msg.dl_done', nm + '.mid'));
    } else {
      downloadBlob(buildMusicXML(score, r.name || dlName),
                   'application/vnd.recordare.musicxml+xml', nm + '.musicxml');
      closeDockModal();
      toast(tt('msg.dl_done', nm + '.musicxml'));
    }
  } catch(e) {
    toast(tt('msg.dl_fail', e.message));
  } finally {
    busy = false;
  }
}

/* ===== 一覧に出す名前を変える（#mUpName） =====
   譜面本体・運指・元のMIDIは触らない＝sig（内容の指紋）も変わらない。
   開くのは一覧の「名前」ボタン（配線は main.js）。 */
let renameId = 0;
export function openRename(id, name) {
  if (!isSignedIn() || !id) return;
  renameId = Number(id) || 0;
  const el = document.getElementById('upName');
  if (el) el.value = String(name || '');
  openDockModal('mUpName');
  /* スマホで勝手に拡大されないよう少し待ってから入力欄へ寄せる（account.js と同じ作法） */
  if (el) setTimeout(() => { try { el.focus(); el.select(); } catch (e) {} }, 60);
}
export async function doRename() {
  if (busy || !isSignedIn() || !renameId) return;
  const el = document.getElementById('upName');
  const nm = el ? el.value.trim() : '';
  if (nm === '') return;
  busy = true;
  try {
    const r = await call('rename', { id: renameId, name: nm });
    if (!r || !r.ok) { toast(tt('msg.up_err', (r && r.message) || '')); return; }
    /* いま進行中の読み込み操作が同じ1件なら、そちらの名前も合わせておく
       （合わせないと、次にトラックを選び直したときに別の1件として扱われる） */
    if (session.id === renameId) session.name = r.name;
    /* いま開いている譜面そのものなら、上部バーに出ている名前もその場で書き換える */
    if (curId === renameId) { ST.scoreTitle = r.name; renderScoreTitle(); }
    renameId = 0;
    closeDockModal();
    await refreshUploads();
    toast(tt('share.renamed'));
  } catch (e) {
    toast(tt('msg.up_err', e.message));
  } finally {
    busy = false;
  }
}

/* ===== 一覧から消す ===== */
export async function deleteUpload(id) {
  if (busy || !isSignedIn() || !id) return;
  if (!window.confirm(tt('msg.up_delete_ask'))) return;
  busy = true;
  try {
    const r = await call('delete', { id: id });
    if (!r || !r.ok) { toast(tt('msg.up_err', (r && r.message) || '')); return; }
    if (Number(id) === curId) { curId = 0; curScore = ''; }
    if (Number(id) === session.id) session.id = 0;
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
  if (applying || !isSignedIn() || !curId) return;
  if (ST.scoreName !== curScore) return;             /* 別の譜面に移っていたら何もしない */
  try { await call('fing', { id: curId, fing: packFing() }); }
  catch (e) { /* 通信できないときはローカルの保存だけで済ませる */ }
}

/* 起動時：ログイン状態が変わるたびに一覧を取り直す（ログイン・ログアウト・自動復元） */
export function initUploads() {
  setSaveWatcher(function () { refreshUploads(); });
  setFingWatcher(function () { updateUploadFingering(); });
  /* 曲が変わったら指板の「公開/非公開」「削除」を出し直す（知らせは modes.js の setScore から） */
  window.addEventListener('gs:scorechanged', function () { syncShareDeleteBtns(); });
  renderUploads();
  syncShareDeleteBtns();
}
