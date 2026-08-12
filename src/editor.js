/*
  editor.js — アップロードした譜面の編集（item6）。

  自分がアップロードした曲（curUploadItem() が返す1件）だけを対象に、
  ・音程の移動（±1／±12 半音）
  ・音符の長さ（音価）の変更
  ・音符／休符の挿入・削除
  を、指板を暗くしないボトムシート（#scoreEdit）から行う。
  画像スキャン（OMR）変換の取りこぼしを、その場で微調整するためのもの。

  ■ データの扱い
    編集は「スロット列（slots）」という一次元の並びで行う。
      slot = {rest:true,  dur}                     … 休符（時間だけ進む）
           = {rest:false, dur, midis:[...], leadIdx} … 音符（原音程＝オクターブ移調前）
    ST.parsed.events（原音程）から作り、編集後は
      onset＝先頭からの累積 dur ／ measure＝floor(onset/拍子)+1
    で並べ直して ST.parsed へ書き戻す（＝JSON曲と同じ「隙間なく詰めた」形）。
    そのあと applyOctave() が表示用の ST.events（移調後＋運指）を作り直す。

    ※ 休符は「音符と音符の隙間」として表す（buildSlots で隙間→休符に復元）。
    ※ 音程は原音程を動かす。画面は移調後なので、押した分だけ見た目も同じだけ動く。
    ※ 保存するまでサーバへは送らない（在庫は ST.parsed 上の編集）。破棄＝開き直し。
*/
import { ST } from './state.js';
import { tt, midiName } from './util.js';
import { toast } from './dom.js';
import { applyOctave, render, invalidateStrip } from './modes.js';
import { stopPlay } from './audio/scheduler.js';
import { chirpEvent } from './fingerboard.js';
import { curUploadItem, saveEditedScore, openUpload } from './uploads.js';

/* 音価チップ（拍数。4分音符＝1）。16分〜全音符＋付点4分。 */
const DURS = [
  { lbl: '1/16', b: 0.25 },
  { lbl: '1/8',  b: 0.5  },
  { lbl: '1/4',  b: 1    },
  { lbl: '1/4·', b: 1.5  },
  { lbl: '1/2',  b: 2    },
  { lbl: '1/1',  b: 4    },
];

let slots = null;   /* 編集中のスロット列。閉じているときは null */
let sel   = 0;      /* いま選んでいるスロットの添字（休符も含む） */
let dirty = false;  /* 保存していない編集があるか */

function r4(x){ return Math.round(x * 10000) / 10000; }
function bpm(){ return (ST.parsed && ST.parsed.beatsPerMeasure) > 0 ? ST.parsed.beatsPerMeasure : 4; }
function isOpen(){ return !!slots && document.getElementById('scoreEdit').classList.contains('open'); }

/* ST.parsed.events（原音程）→ スロット列。音符の間に隙間があれば休符を挟む。 */
function buildSlots(){
  const evs = (ST.parsed && ST.parsed.events ? ST.parsed.events.slice() : [])
                .sort((a, b) => a.onset - b.onset);
  /* スラー群の端（開始/終了イベント）に印を付けておく。編集で音符を足し引きしても、
     この印が付いたスロットが残っているかどうかで、あとから群を組み直せる（buildSlots は開いた時だけ）。 */
  const slurs = (ST.parsed && Array.isArray(ST.parsed.slurs)) ? ST.parsed.slurs : [];
  const startAt = {}, stopAt = {};
  slurs.forEach((g, idx) => {
    (startAt[g[0]] || (startAt[g[0]] = [])).push(idx);
    (stopAt[g[1]]  || (stopAt[g[1]]  = [])).push(idx);
  });
  const out = [];
  let prevEnd = 0, ni = 0;
  for(const e of evs){
    const d = (e.dur > 0) ? e.dur : 0.5;
    const gap = e.onset - prevEnd;
    if(gap > 1e-3) out.push({ rest: true, dur: r4(gap) });
    const slot = {
      rest: false, dur: r4(d),
      midis: e.pitches.map(p => p.midi),
      leadIdx: Math.min(e.leadIdx || 0, Math.max(0, e.pitches.length - 1)),
    };
    if(startAt[ni]) slot.slurStart = startAt[ni].slice();
    if(stopAt[ni])  slot.slurStop  = stopAt[ni].slice();
    out.push(slot);
    ni++;
    prevEnd = e.onset + d;
  }
  if(!out.length) out.push({ rest: false, dur: 1, midis: [60], leadIdx: 0 });
  return out;
}

/* スロット列 → ST.parsed（events / measures）へ。ST.events も applyOctave で作り直す。 */
function rebuildParsed(){
  const per = bpm();
  let onset = 0;
  const evs = [];
  for(const sl of slots){
    if(!sl.rest && sl.midis && sl.midis.length){
      evs.push({
        id: evs.length,
        onset: r4(onset),
        dur: r4(sl.dur),
        measure: Math.floor((onset + 1e-6) / per) + 1,
        pitches: sl.midis.map(m => ({ midi: m, name: midiName(m) })),
        leadIdx: Math.min(sl.leadIdx || 0, sl.midis.length - 1),
        fing: null,
      });
    }
    onset += sl.dur;
  }
  ST.parsed.events = evs;
  const maxM = Math.max(1, Math.ceil((onset - 1e-6) / per));
  const measures = [];
  for(let m = 1; m <= maxM; m++) measures.push({ num: m, start: (m - 1) * per, end: m * per });
  ST.parsed.measures = measures;
  ST.measures = measures;          /* totalBeats / シークバーが見るのはこちら */

  /* スラーを組み直す。生き残った印（slurStart/slurStop）の新しい音符番号で開始・終了を取る。
     ・端の音符が消えた群は落とす。
     ・スラーの内側に音符を足したら、範囲は自然に広がる（開始と終了のあいだに入るため）。 */
  const startIdx = {}, stopIdx = {};
  let ni2 = 0;
  for(const sl of slots){
    if(!sl.rest && sl.midis && sl.midis.length){
      if(sl.slurStart) for(const id of sl.slurStart) startIdx[id] = ni2;
      if(sl.slurStop)  for(const id of sl.slurStop)  stopIdx[id]  = ni2;
      ni2++;
    }
  }
  const newSlurs = [];
  const ids = new Set(Object.keys(startIdx).concat(Object.keys(stopIdx)));
  for(const id of ids){
    const a = startIdx[id], b = stopIdx[id];
    if(a != null && b != null && b > a) newSlurs.push([a, b]);
  }
  newSlurs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  ST.parsed.slurs = newSlurs;

  applyOctave();                   /* 移調後の ST.events と運指を作り直す（render はしない） */
}

/* いま選んでいるスロット（音符）に対応する ST.events の添字。休符なら直近の音符。 */
function eventIndexForSel(){
  let idx = -1, c = 0;
  for(let i = 0; i < slots.length; i++){
    if(!slots[i].rest){
      if(i <= sel) idx = c;      /* sel 以下でいちばん後ろの音符 */
      c++;
    }
  }
  return idx;
}

/* スロット→データ反映→選択の同期→画面更新。編集操作のたびに呼ぶ。 */
function commit(){
  rebuildParsed();
  const evIdx = eventIndexForSel();
  if(evIdx >= 0 && evIdx < ST.events.length){ ST.selected = evIdx; ST.current = null; }
  invalidateStrip();               /* 音程だけ変えたときも nchip を作り直す */
  render();
  renderEditor();
}

/* いま選んでいる音を鳴らす（移調後・運指つきの ST.events を鳴らす） */
function chirpSel(){
  const evIdx = eventIndexForSel();
  const cur = slots[sel];
  if(cur && !cur.rest && evIdx >= 0) chirpEvent(ST.events[evIdx]);
}

/* シートの中身を描く */
function renderEditor(){
  const box = document.getElementById('seBody');
  if(!box || !slots) return;
  const cur = slots[sel];
  const per = bpm();

  /* いま選んでいるスロットの小節（先頭からの累積で数える） */
  let onset = 0;
  for(let i = 0; i < sel; i++) onset += slots[i].dur;
  const measure = Math.floor((onset + 1e-6) / per) + 1;

  /* 何個目か（音符だけ数える）／全音符数 */
  let notePos = 0, noteTotal = 0;
  for(let i = 0; i < slots.length; i++){
    if(!slots[i].rest){ noteTotal++; if(i <= sel) notePos = noteTotal; }
  }
  const posTxt = cur.rest ? tt('msg.se_rest') : tt('msg.se_pos', notePos, noteTotal);

  const nameTxt = cur.rest
    ? tt('msg.se_rest')
    : cur.midis.map((m, i) => (i === cur.leadIdx)
        ? `<b>${midiName(m)}</b>` : `<span class="oth">${midiName(m)}</span>`).join(' ');

  /* 音程ボタン（休符では無効） */
  const pd = cur.rest ? ' disabled' : '';
  const pitchRow =
    `<div class="se-row"><div class="se-lbl">${tt('ui.se_pitch')}</div><div class="se-btns">`
    + `<button class="se-b" data-act="pitch" data-d="-12"${pd}>−12</button>`
    + `<button class="se-b" data-act="pitch" data-d="-1"${pd}>−1</button>`
    + `<button class="se-b" data-act="pitch" data-d="1"${pd}>+1</button>`
    + `<button class="se-b" data-act="pitch" data-d="12"${pd}>+12</button>`
    + `</div></div>`;

  /* 長さ（音価）チップ。いまの長さに一致するものを on にする */
  const lenChips = DURS.map(d =>
    `<button class="se-chip${Math.abs(d.b - cur.dur) < 1e-6 ? ' on' : ''}" data-act="len" data-b="${d.b}">${d.lbl}</button>`
  ).join('');
  const lenRow = `<div class="se-row"><div class="se-lbl">${tt('ui.se_len')}</div><div class="se-btns">${lenChips}</div></div>`;

  /* 挿入・削除・試聴 */
  const opRow =
    `<div class="se-row se-ops">`
    + `<button class="se-b" data-act="insNote">＋ ${tt('ui.se_ins_note')}</button>`
    + `<button class="se-b" data-act="insRest">＋ ${tt('ui.se_ins_rest')}</button>`
    + `<button class="se-b se-del" data-act="del">🗑 ${tt('ui.se_del')}</button>`
    + `<button class="se-b" data-act="play"${cur.rest ? ' disabled' : ''}>▶ ${tt('ui.se_audition')}</button>`
    + `</div>`;

  box.innerHTML =
    `<div class="se-cur"><span class="se-pos">${posTxt}</span>`
    + `<span class="se-name">${nameTxt}</span>`
    + `<span class="se-meas">${measure}</span></div>`
    + pitchRow + lenRow + opRow;

  /* 前後ボタンの端の無効化 */
  const pv = document.getElementById('sePrev'), nx = document.getElementById('seNext');
  if(pv) pv.disabled = (sel <= 0);
  if(nx) nx.disabled = (sel >= slots.length - 1);
}

/* ===== 公開API（配線は main.js） ===== */

export function openScoreEditor(){
  if(ST.mode !== 'score'){ return; }
  const it = curUploadItem();
  if(!it){ toast(tt('msg.se_need_own')); return; }
  if(ST.playing) stopPlay();

  slots = buildSlots();
  /* いま選んでいる音符（ST.selected）に対応するスロットへ合わせる */
  sel = 0;
  const target = (ST.selected != null) ? ST.selected : 0;
  let c = 0;
  for(let i = 0; i < slots.length; i++){
    if(!slots[i].rest){ if(c === target){ sel = i; break; } c++; }
  }
  dirty = false;

  /* 運指編集シートが開いていれば閉じる（同時に出さない） */
  const es = document.getElementById('editSheet'); if(es) es.classList.remove('open');
  const esc = document.getElementById('editScrim'); if(esc) esc.classList.remove('show');

  document.getElementById('scoreEdit').classList.add('open');
  renderEditor();
}

export function closeScoreEditor(force){
  if(!isOpen()){ document.getElementById('scoreEdit').classList.remove('open'); return; }
  if(dirty && !force){
    if(confirm(tt('msg.se_discard'))){
      /* 破棄＝サーバの保存内容へ戻す（開き直す） */
      const it = curUploadItem();
      document.getElementById('scoreEdit').classList.remove('open');
      slots = null; dirty = false;
      if(it) openUpload(it.id);
      return;
    }
    return;                              /* キャンセル＝閉じない */
  }
  document.getElementById('scoreEdit').classList.remove('open');
  slots = null; dirty = false;
}

/* 前後の音（スロット）へ */
export function seNav(dir){
  if(!isOpen()) return;
  const n = sel + (dir < 0 ? -1 : 1);
  if(n < 0 || n >= slots.length) return;
  sel = n;
  const evIdx = eventIndexForSel();
  if(evIdx >= 0 && evIdx < ST.events.length){ ST.selected = evIdx; ST.current = null; render(); }
  renderEditor();
  chirpSel();                            /* めくったら鳴らす（item5と同じ気持ち） */
}

/* シート内ボタン（委譲） */
export function seBodyClick(e){
  if(!isOpen()) return;
  const b = e.target.closest('[data-act]');
  if(!b || b.disabled) return;
  const act = b.dataset.act;
  const cur = slots[sel];

  if(act === 'pitch'){
    if(cur.rest) return;
    const d = parseInt(b.dataset.d, 10) || 0;
    const i = cur.leadIdx;
    const nv = Math.max(0, Math.min(127, cur.midis[i] + d));
    if(nv === cur.midis[i]) return;
    cur.midis[i] = nv;
    dirty = true; commit(); chirpSel();
    return;
  }
  if(act === 'len'){
    const nb = parseFloat(b.dataset.b);
    if(!(nb > 0) || Math.abs(nb - cur.dur) < 1e-6) return;
    cur.dur = nb;
    dirty = true; commit();
    return;
  }
  if(act === 'insNote'){
    /* いまの音（休符なら直近の音）の音程・長さを引き継いで、後ろへ1つ足す */
    let midi = 60, dur = cur.dur || 1;
    if(!cur.rest){ midi = cur.midis[cur.leadIdx]; }
    else {
      for(let i = sel; i >= 0; i--){ if(!slots[i].rest){ midi = slots[i].midis[slots[i].leadIdx]; break; } }
    }
    slots.splice(sel + 1, 0, { rest: false, dur: r4(dur), midis: [midi], leadIdx: 0 });
    sel = sel + 1; dirty = true; commit(); chirpSel();
    return;
  }
  if(act === 'insRest'){
    slots.splice(sel + 1, 0, { rest: true, dur: r4(cur.dur || 1) });
    sel = sel + 1; dirty = true; commit();
    return;
  }
  if(act === 'del'){
    const notes = slots.filter(s => !s.rest).length;
    if(!cur.rest && notes <= 1){ toast(tt('msg.se_save_fail')); return; }   /* 最後の1音は消さない */
    slots.splice(sel, 1);
    if(!slots.length) slots.push({ rest: false, dur: 1, midis: [60], leadIdx: 0 });
    if(sel >= slots.length) sel = slots.length - 1;
    dirty = true; commit();
    return;
  }
  if(act === 'play'){ chirpSel(); return; }
}

export async function seSave(){
  if(!isOpen()) return;
  const ok = await saveEditedScore(ST.parsed, ST.tempo);
  if(ok) dirty = false;
}
