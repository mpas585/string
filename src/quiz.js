/*
  quiz.js — 座学クイズ（2種類）。画面は #quizView（includes/views/app.php）ひとつで完結する。

    楽譜クイズ（mode 'squiz'）
      ・五線に音符を1つ、または記号を1つ出し、4択で答える
      ・音符は「ミ（E）」のように階名と英米式の音名を並べて出す。♯・♭も混ぜる
      ・記号は強弱・速さ・奏法・反復・音符と休符の種類から出す（文言は quiz.sym）

    指板クイズ（mode 'bquiz'）
      ・「ミ（E）」の場所をタップ。どの弦・どのオクターブで答えても正解
      ・タップ位置は半音の 0.6 ぶんまでずれても正解にする（指で押すと少しずれるため）
      ・🔊 で出題中の音を聴ける（曲を練習と同じ音源 src/audio/synth.js の playNote）

  どちらも5問続けて出し、1問20点の100点満点。最高点は端末に残す（Store 'cf:quiz:v1'）。
  正解・不正解は画面全体に赤ペンの ○ / × を描いて知らせ（#qzFx）、少し待って次の問題へ進む。

  モードの出入りは src/modes.js の setMode から enterQuiz / leaveQuiz を呼ぶ。
  ボタンの配線は initQuiz（src/main.js が起動時に1回呼ぶ）。
*/
import { ST } from './state.js';
import { OPEN, STRNAME, tt, fracOf } from './util.js';
import { Store } from './drawer.js';
import { audio, makeBuses, NOISEBUF } from './audio/context.js';
import { playNote } from './audio/synth.js';
import { ensureInstruments, connectSmplr } from './audio/smplr-inst.js';
import { CLEFS, diatonicIndex } from './notation.js';
import { SYMBOLS, symbolSvg, staffNoteSvg } from './quiz-symbols.js';

const N = 5;                       /* 1回の問題数 */
const PTS = 20;                    /* 1問の点数 */
const TOL = 0.6;                   /* 指板クイズ：許すずれ（半音） */
const WAIT_OK = 1250;              /* 正解のあと次へ進むまで（ms） */
const WAIT_NG = 2300;              /* 不正解のあと。正しい答えを見る時間を長めに取る */
const STORE_KEY = 'cf:quiz:v1';

/* 音名。度数（C=0..B=6）と、その半音位置 */
const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const PC  = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '1': '♯', '-1': '♭', '0': '' };

/* ===== 状態 ===== */
const QZ = {
  mode: null,                      /* 'squiz' | 'bquiz' | null */
  qs: [], i: 0, results: [],
  lock: false, timer: 0, fxTimer: 0,
  cfg: { kind: 'mix', clef: null, acc: 'on', range: 'low' },
  best: { squiz: null, bquiz: null },
};
let wired = false;

const $ = id => document.getElementById(id);
const rnd = n => Math.floor(Math.random() * n);
function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ===== 文言 ===== */
function dict(){ return (typeof window !== 'undefined' && window.T && window.T.quiz) ? window.T.quiz : {}; }
function solfa(){
  const a = dict().solfa;
  return (Array.isArray(a) && a.length === 7) ? a : ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
}
/* 「ミ（E）」「ファ♯（F♯）」。並びは言語ごと（quiz.note_fmt） */
export function noteLabel(l, a){
  const s = ACC[String(a)] || '';
  const v = tt('quiz.note_fmt', solfa()[l] + s, LET[l] + s);
  return (v === 'quiz.note_fmt') ? (LET[l] + s) : v;
}
function symText(id){
  const m = dict().sym;
  const v = m && m[id];
  return (Array.isArray(v) && v.length >= 2) ? v : [id, id];
}

/* ===== 設定と最高点（端末に保存）===== */
function defaultClef(){
  const c = (typeof window !== 'undefined' && window.INSTRUMENT && window.INSTRUMENT.clef) || '';
  if (CLEFS[c]) return c;
  /* 'auto'（チェロ等）は開放弦の高さで決める：ヴァイオリン=ト音／ヴィオラ=ハ音／チェロ=ヘ音 */
  if (OPEN[0] >= 55) return 'treble';
  if (OPEN[0] >= 48) return 'alto';
  return 'bass';
}
function loadStore(){
  QZ.cfg.clef = defaultClef();
  try {
    const raw = Store.get(STORE_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && o.cfg){
      if (['mix', 'note', 'sym'].includes(o.cfg.kind)) QZ.cfg.kind = o.cfg.kind;
      if (CLEFS[o.cfg.clef]) QZ.cfg.clef = o.cfg.clef;
      if (['on', 'off'].includes(o.cfg.acc)) QZ.cfg.acc = o.cfg.acc;
      if (['low', 'oct'].includes(o.cfg.range)) QZ.cfg.range = o.cfg.range;
    }
    if (o && o.best){
      for (const k of ['squiz', 'bquiz']) if (typeof o.best[k] === 'number') QZ.best[k] = o.best[k];
    }
  } catch (e) {}
}
function saveStore(){
  try { Store.set(STORE_KEY, JSON.stringify({ cfg: QZ.cfg, best: QZ.best })); } catch (e) {}
}

/* ===== 音（曲を練習と同じ音源）=====
   再生用のバス（ST.buses）は ▶ のたびに作り直されて止めると外れるので、
   クイズは自分のバスを1組だけ持ち、サンプル音源の出口もそこへつなぐ。
   ▶ 側は startPlay で自分のバスへつなぎ直すので、取り合いにはならない。 */
let qb = null;
function quizCtx(){
  const ctx = audio();
  if (!ST.noise) ST.noise = NOISEBUF;
  if (!qb) qb = makeBuses(ctx);
  connectSmplr(qb);
  return ctx;
}
function playMidi(midi, dur){
  try {
    ensureInstruments();
    const ctx = quizCtx();
    playNote(ctx, qb.lead, midi, ctx.currentTime + 0.05, dur || 1.0);
  } catch (e) {}
}
function audioOff(){
  if (!qb) return;
  const B = qb; qb = null;
  try {
    const ctx = audio(), t = ctx.currentTime;
    B.master.gain.cancelScheduledValues(t);
    B.master.gain.setValueAtTime(B.master.gain.value, t);
    B.master.gain.linearRampToValueAtTime(0.0001, t + 0.05);
  } catch (e) {}
  setTimeout(() => { try { B.master.disconnect(); if (B.conv) B.conv.disconnect(); if (B.limiter) B.limiter.disconnect(); } catch (e) {} }, 250);
}

/* ===== 問題づくり：楽譜クイズ ===== */
/* 使わない綴り（E♯・B♯・C♭・F♭）。初心者向けの座学なので出さない */
function validAcc(l, a){
  if (a === 1 && (l === 2 || l === 6)) return false;
  if (a === -1 && (l === 0 || l === 3)) return false;
  return true;
}
function pcOf(l, a){ return ((PC[l] + a) % 12 + 12) % 12; }

function makeNoteQ(used){
  const clef = QZ.cfg.clef;
  const baseDia = diatonicIndex(CLEFS[clef].base);       /* 第1線の音（C4=0 から数えた段） */
  for (let tries = 0; tries < 60; tries++){
    const step = rnd(15) - 3;                              /* 第1線の下の加線〜第5線の上の加線（-3〜11） */
    let a = (Math.random() < 0.3) ? (Math.random() < 0.5 ? 1 : -1) : 0;
    const d = baseDia + step;
    const l = ((d % 7) + 7) % 7;
    const oct = 4 + Math.floor(d / 7);
    if (!validAcc(l, a)) a = 0;
    const key = 'n' + l + ':' + a;
    if (used.has(key)) continue;
    used.add(key);
    const midi = 12 * (oct + 1) + PC[l] + a;

    /* はずれ：同じ音名の別の臨時記号、近くの音名。答えと同じ高さ（異名同音）は混ぜない */
    const pc = pcOf(l, a);
    const cands = [];
    for (const a2 of [0, 1, -1]) if (a2 !== a && validAcc(l, a2)) cands.push([l, a2]);
    for (const dl of [-1, 1, -2, 2, 3, -3]){
      const l2 = (l + dl + 7) % 7;
      cands.push([l2, 0]);
      if (a !== 0 && validAcc(l2, a)) cands.push([l2, a]);
    }
    const seen = new Set([noteLabel(l, a)]);
    const wrong = [];
    for (const [l2, a2] of shuffle(cands)){
      if (pcOf(l2, a2) === pc) continue;
      const t = noteLabel(l2, a2);
      if (seen.has(t)) continue;
      seen.add(t); wrong.push(t);
      if (wrong.length === 3) break;
    }
    const answer = noteLabel(l, a);
    return {
      type: 'note', q: tt('quiz.q_note'), svg: staffNoteSvg(clef, step, a),
      opts: shuffle([answer, ...wrong]), answer, midi, exp: '',
    };
  }
  return null;
}

function makeSymQ(used){
  const pool = SYMBOLS.filter(s => !used.has('s' + s.id));
  if (!pool.length) return null;
  const s = pool[rnd(pool.length)];
  used.add('s' + s.id);
  const same = shuffle(SYMBOLS.filter(x => x.group === s.group && x.id !== s.id)).slice(0, 3);
  const [name, mean] = symText(s.id);
  const answer = mean;
  return {
    type: 'sym', q: tt(s.group === 'val' ? 'quiz.q_val' : 'quiz.q_sym'), svg: symbolSvg(s.id, QZ.cfg.clef),
    opts: shuffle([answer, ...same.map(x => symText(x.id)[1])]), answer, midi: null,
    exp: (s.group === 'val') ? mean : tt('quiz.exp_sym', name, mean),
  };
}

function makeStaffRound(){
  let kinds;
  if (QZ.cfg.kind === 'note') kinds = ['n', 'n', 'n', 'n', 'n'];
  else if (QZ.cfg.kind === 'sym') kinds = ['s', 's', 's', 's', 's'];
  else kinds = shuffle(['n', 'n', 's', 's', Math.random() < 0.5 ? 'n' : 's']);
  const used = new Set(), out = [];
  for (const k of kinds){
    const q = (k === 'n') ? makeNoteQ(used) : makeSymQ(used);
    if (q) out.push(q);
  }
  return out;
}

/* ===== 問題づくり：指板クイズ ===== */
function boardMax(){ return (QZ.cfg.range === 'oct') ? 12 : 7; }
function makeBoardQ(used){
  const nat = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]];
  const acc = [[0, 1], [1, 1], [3, 1], [4, 1], [5, 1], [1, -1], [2, -1], [4, -1], [5, -1], [6, -1]];
  const max = boardMax();
  for (let tries = 0; tries < 60; tries++){
    const useAcc = QZ.cfg.acc === 'on' && Math.random() < 0.4;
    const list = useAcc ? acc : nat;
    const [l, a] = list[rnd(list.length)];
    const pc = pcOf(l, a);
    if (used.has(pc)) continue;                       /* 同じ高さ（異名同音も）は1回に1度だけ */
    used.add(pc);
    const inst = [];
    for (let s = 0; s < OPEN.length; s++){
      for (let off = 0; off <= max; off++) if (((OPEN[s] + off) % 12 + 12) % 12 === pc) inst.push({ s, off, midi: OPEN[s] + off });
    }
    if (!inst.length) continue;
    const label = noteLabel(l, a);
    return {
      type: 'board', q: tt('quiz.q_board', label), label, l, a, pc, inst,
      midi: inst[rnd(inst.length)].midi, answer: label, exp: '',
    };
  }
  return null;
}
function makeBoardRound(){
  const used = new Set(), out = [];
  for (let i = 0; i < N; i++){ const q = makeBoardQ(used); if (q) out.push(q); }
  return out;
}

/* ===== 指板の絵（クイズ専用。音名は出さない）=====
   本体の指板（src/fingerboard.js）と同じく、ナットからの距離は弦長比（fracOf）で並べる。
   描くのは開放〜 max 半音だけにして、1画面に収める。 */
const BG = { W: 300, NUT: 64, LEN: 560, X0: 44, X1: 256 };
function bStrX(i){
  const n = OPEN.length, pad = 26;
  return BG.X0 + pad + i * ((BG.X1 - BG.X0 - 2 * pad) / (n - 1));
}
function bFmax(){ return fracOf(boardMax() + 0.5); }      /* 最後の位置の下に半音ぶんの余白 */
function bY(off){ return BG.NUT + fracOf(off) / bFmax() * BG.LEN; }
function bOff(y){
  if (y <= BG.NUT) return 0;
  const f = Math.min(0.9995, (y - BG.NUT) / BG.LEN * bFmax());
  return -12 * Math.log2(1 - f);
}
function boardSvg(){
  const max = boardMax();
  const H = BG.NUT + BG.LEN + 18;
  const p = [];
  p.push(`<svg id="qzBoardSvg" viewBox="0 0 ${BG.W} ${H}" xmlns="http://www.w3.org/2000/svg">`);
  p.push(`<rect x="${BG.X0}" y="${BG.NUT - 6}" width="${BG.X1 - BG.X0}" height="${BG.LEN + 18}" rx="12" fill="var(--board)" stroke="var(--board-edge)"/>`);
  for (let off = 1; off <= max; off++){
    const y = bY(off).toFixed(1);
    p.push(`<line x1="${BG.X0}" y1="${y}" x2="${BG.X1}" y2="${y}" stroke="#4a3e30" stroke-width="1"/>`);
    p.push(`<text x="${BG.X0 - 7}" y="${(+y + 3.5).toFixed(1)}" fill="var(--faint)" font-size="11" text-anchor="end" font-family="var(--mono)">${off}</text>`);
  }
  /* ナット（ここより上をタップ＝開放弦） */
  p.push(`<rect x="${BG.X0 - 2}" y="${BG.NUT - 7}" width="${BG.X1 - BG.X0 + 4}" height="7" rx="2" fill="#d9cfbf"/>`);
  const sw = [3.6, 3.0, 2.4, 1.9];
  for (let i = 0; i < OPEN.length; i++){
    const x = bStrX(i).toFixed(1);
    p.push(`<line x1="${x}" y1="${BG.NUT - 7}" x2="${x}" y2="${BG.NUT + BG.LEN + 12}" stroke="var(--string)" stroke-width="${sw[i] || 2}" opacity="0.9"/>`);
    p.push(`<text x="${x}" y="${BG.NUT - 20}" fill="var(--muted)" font-size="15" font-weight="700" text-anchor="middle" font-family="var(--mono)">${esc(STRNAME[i] || '')}</text>`);
  }
  p.push('<g id="qzMarks"></g>');
  p.push('</svg>');
  return p.join('');
}
/* タップ位置 → 弦と半音（連続値） */
function boardPoint(e){
  const svg = $('qzBoardSvg');
  if (!svg || !svg.getScreenCTM) return null;
  const ctm = svg.getScreenCTM(); if (!ctm) return null;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(ctm.inverse());
  let si = 0, best = 1e9;
  for (let i = 0; i < OPEN.length; i++){ const d = Math.abs(p.x - bStrX(i)); if (d < best){ best = d; si = i; } }
  const gap = (bStrX(1) - bStrX(0));
  if (best > gap * 0.62) return null;                   /* 弦と弦の間のまん中あたりは無視 */
  if (p.y < BG.NUT - 46 || p.y > BG.NUT + BG.LEN + 16) return null;
  return { s: si, off: bOff(p.y) };
}
/* 指板の上に印を置く（○＝正解の場所／× ＝タップした場所） */
function markDot(i, off, cls, text){
  const x = bStrX(i).toFixed(1), y = bY(off).toFixed(1);
  const t = text ? `<text x="${x}" y="${(+y + 4).toFixed(1)}" font-size="10" font-weight="700" text-anchor="middle" fill="#10240f">${esc(text)}</text>` : '';
  return `<g class="qzm ${cls}"><circle cx="${x}" cy="${y}" r="12"/>${t}</g>`;
}
function markCross(i, off){
  const x = bStrX(i), y = bY(off);
  return `<g class="qzm qzm-ng"><path d="M ${x - 9} ${y - 9} L ${x + 9} ${y + 9} M ${x + 9} ${y - 9} L ${x - 9} ${y + 9}"/></g>`;
}
/* タップした音の名前。答えが♭系なら♭で、それ以外は♯で読む */
function nameOfMidi(midi, preferFlat){
  const pc = ((midi % 12) + 12) % 12;
  for (let l = 0; l < 7; l++) if (PC[l] === pc) return noteLabel(l, 0);
  if (preferFlat){ for (let l = 0; l < 7; l++) if (pcOf(l, -1) === pc) return noteLabel(l, -1); }
  for (let l = 0; l < 7; l++) if (pcOf(l, 1) === pc) return noteLabel(l, 1);
  return '';
}

/* ===== 赤ペンの ○ / × ===== */
const PEN_O = '<svg viewBox="0 0 120 120" aria-hidden="true"><path class="pen" pathLength="100" d="M 66 14 C 96 16 110 42 106 66 C 102 94 74 110 48 104 C 22 98 10 70 16 46 C 22 24 42 12 70 16"/></svg>';
const PEN_X = '<svg viewBox="0 0 120 120" aria-hidden="true"><path class="pen" pathLength="100" d="M 24 22 C 50 46 72 70 98 98"/><path class="pen pen2" pathLength="100" d="M 98 24 C 72 48 48 72 22 98"/></svg>';

function showFx(ok){
  const fx = $('qzFx');
  if (!fx) return;
  clearTimeout(QZ.fxTimer);
  fx.className = 'qz-fx';
  fx.innerHTML = `<div class="qz-fx-in">${ok ? PEN_O : PEN_X}<b>${esc(tt(ok ? 'quiz.ok' : 'quiz.ng'))}</b></div>`;
  void fx.offsetWidth;                                   /* アニメーションを頭から */
  fx.classList.add('show', ok ? 'ok' : 'ng');
  QZ.fxTimer = setTimeout(() => { fx.className = 'qz-fx'; fx.innerHTML = ''; }, ok ? 1150 : 1400);
}
function hideFx(){
  clearTimeout(QZ.fxTimer);
  const fx = $('qzFx');
  if (fx){ fx.className = 'qz-fx'; fx.innerHTML = ''; }
}

/* ===== 画面の切り替え ===== */
function showPanel(name){
  for (const [id, n] of [['qzStart', 'start'], ['qzPlay', 'play'], ['qzRes', 'res']]){
    const el = $(id); if (el) el.hidden = (n !== name);
  }
  const v = $('quizView'); if (v) v.scrollTop = 0;
}
function syncChips(){
  document.querySelectorAll('#quizView [data-qkey]').forEach(g => {
    const k = g.dataset.qkey;
    g.querySelectorAll('button[data-v]').forEach(b => {
      const on = (QZ.cfg[k] === b.dataset.v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });
}
function bestText(){
  const b = QZ.best[QZ.mode];
  return (typeof b === 'number') ? tt('quiz.best', b) : tt('quiz.best_none');
}
function renderStart(){
  const t = $('qzTitle'), l = $('qzLead'), b = $('qzBest');
  if (t) t.textContent = tt(QZ.mode === 'bquiz' ? 'quiz.mode_board' : 'quiz.mode_staff');
  if (l) l.textContent = tt(QZ.mode === 'bquiz' ? 'quiz.lead_board' : 'quiz.lead_staff');
  if (b) b.textContent = bestText();
  syncChips();
  showPanel('start');
}

function renderDots(){
  const box = $('qzDots'); if (!box) return;
  const out = [];
  for (let k = 0; k < QZ.qs.length; k++){
    const r = QZ.results[k];
    const cls = (r == null) ? (k === QZ.i ? 'cur' : '') : (r.ok ? 'ok' : 'ng');
    out.push(`<i class="${cls}"></i>`);
  }
  box.innerHTML = out.join('');
  const num = $('qzNum'); if (num) num.textContent = tt('quiz.progress', Math.min(QZ.i + 1, QZ.qs.length), QZ.qs.length);
  const pts = $('qzPts'); if (pts) pts.textContent = (QZ.results.filter(r => r && r.ok).length * PTS) + ' ' + tt('quiz.point');
}

function renderQ(){
  const q = QZ.qs[QZ.i];
  QZ.lock = false;
  renderDots();
  $('qzQ').textContent = q.q;
  const sub = $('qzSub');
  sub.textContent = (q.type === 'board') ? tt('quiz.q_board_s') : '';
  const stage = $('qzStage');
  stage.className = 'qz-stage ' + (q.type === 'board' ? 'is-board' : 'is-staff');
  stage.innerHTML = (q.type === 'board') ? boardSvg() : q.svg;
  const exp = $('qzExp'); exp.textContent = ''; exp.className = 'qz-exp';
  const opts = $('qzOpts');
  if (q.type === 'board'){
    opts.innerHTML = '';
  } else {
    opts.innerHTML = q.opts.map((o, k) =>
      `<button type="button" class="qz-opt" data-k="${k}"><span class="qz-opt-t">${esc(o)}</span><span class="qz-mark" aria-hidden="true"></span></button>`).join('');
  }
}

function startRound(){
  clearTimeout(QZ.timer);
  hideFx();
  QZ.qs = (QZ.mode === 'bquiz') ? makeBoardRound() : makeStaffRound();
  QZ.i = 0; QZ.results = [];
  if (QZ.mode === 'bquiz') ensureInstruments();          /* 🔊 の初回が遅れないよう先に読み始める */
  showPanel('play');
  renderQ();
}

function afterAnswer(ok){
  showFx(ok);
  renderDots();
  QZ.timer = setTimeout(() => {
    QZ.i++;
    if (QZ.i < QZ.qs.length) renderQ(); else finish();
  }, ok ? WAIT_OK : WAIT_NG);
}

/* 楽譜クイズ：選択肢を押した */
function answerOpt(k){
  if (QZ.lock) return;
  const q = QZ.qs[QZ.i]; if (!q || q.type === 'board') return;
  QZ.lock = true;
  const pick = q.opts[k];
  const ok = (pick === q.answer);
  QZ.results[QZ.i] = { ok, q: q.q, answer: q.answer, pick };
  document.querySelectorAll('#qzOpts .qz-opt').forEach((b, j) => {
    b.disabled = true;
    const m = b.querySelector('.qz-mark');
    if (q.opts[j] === q.answer){ b.classList.add('is-ok'); if (m) m.innerHTML = PEN_O; }
    else if (j === k){ b.classList.add('is-ng'); if (m) m.innerHTML = PEN_X; }
  });
  const exp = $('qzExp');
  exp.textContent = q.exp || (ok ? '' : tt('quiz.answer_is', q.answer));
  exp.className = 'qz-exp show ' + (ok ? 'ok' : 'ng');
  if (q.midi != null) playMidi(q.midi, 0.9);               /* 音符問題は答えた音を鳴らす */
  afterAnswer(ok);
}

/* 指板クイズ：指板をタップした */
function answerTap(e){
  if (QZ.lock) return;
  const q = QZ.qs[QZ.i]; if (!q || q.type !== 'board') return;
  const pos = boardPoint(e); if (!pos) return;
  QZ.lock = true;
  const hit = q.inst.find(p => p.s === pos.s && Math.abs(p.off - pos.off) <= TOL);
  const ok = !!hit;
  const max = boardMax();
  const tOff = ok ? hit.off : Math.max(0, Math.min(max, Math.round(pos.off)));
  const tMidi = OPEN[pos.s] + tOff;
  const marks = $('qzMarks');
  if (marks){
    const parts = q.inst.map(p => markDot(p.s, p.off, (ok && p === hit) ? 'qzm-hit' : 'qzm-ans', ''));
    if (!ok) parts.push(markCross(pos.s, tOff));
    marks.innerHTML = parts.join('');
  }
  QZ.results[QZ.i] = { ok, q: q.q, answer: q.answer, pick: nameOfMidi(tMidi, q.a === -1) };
  const exp = $('qzExp');
  exp.textContent = ok ? '' : tt('quiz.you_tapped', nameOfMidi(tMidi, q.a === -1));
  exp.className = 'qz-exp show ' + (ok ? 'ok' : 'ng');
  if (ok) playMidi(tMidi, 0.9);
  afterAnswer(ok);
}

function finish(){
  const n = QZ.qs.length;
  const okN = QZ.results.filter(r => r && r.ok).length;
  const score = okN * PTS;
  const prev = QZ.best[QZ.mode];
  const isNew = (typeof prev !== 'number') || score > prev;
  if (isNew){ QZ.best[QZ.mode] = score; saveStore(); }
  $('qzResScore').textContent = String(score);
  $('qzResCount').textContent = tt('quiz.res_count', okN, n);
  $('qzResMsg').textContent = tt(okN === n ? 'quiz.res_perfect' : (okN >= n - 2 ? 'quiz.res_good' : 'quiz.res_try'));
  const nb = $('qzResNew'); if (nb) nb.hidden = !(isNew && score > 0);
  $('qzResBest').textContent = bestText();
  $('qzResList').innerHTML = QZ.results.map((r, k) =>
    `<li class="${r.ok ? 'ok' : 'ng'}"><span class="qz-rl-m" aria-hidden="true">${r.ok ? '○' : '×'}</span>` +
    `<span class="qz-rl-q">${k + 1}. ${esc(r.q)}</span><b>${esc(r.answer)}</b></li>`).join('');
  showPanel('res');
}

/* ===== 出入り（src/modes.js の setMode から）===== */
export function isQuizMode(m){ return m === 'squiz' || m === 'bquiz'; }
export function enterQuiz(mode){
  if (!isQuizMode(mode)) return;
  if (!QZ.cfg.clef) loadStore();                          /* initQuiz より先に呼ばれたときの保険 */
  clearTimeout(QZ.timer);
  hideFx();
  QZ.mode = mode;
  QZ.qs = []; QZ.i = 0; QZ.results = []; QZ.lock = false;
  renderStart();
}
export function leaveQuiz(){
  clearTimeout(QZ.timer);
  hideFx();
  audioOff();
  QZ.mode = null; QZ.qs = []; QZ.results = []; QZ.lock = false;
  const stage = $('qzStage'); if (stage) stage.innerHTML = '';
}

/* ===== 配線（起動時に1回）===== */
export function initQuiz(){
  if (wired) return;
  const view = $('quizView');
  if (!view) return;                                      /* 単体版 index.html には画面が無い */
  wired = true;
  loadStore();
  view.addEventListener('click', e => {
    const chip = e.target.closest('[data-qkey] button[data-v]');
    if (chip){
      const k = chip.closest('[data-qkey]').dataset.qkey;
      QZ.cfg[k] = chip.dataset.v;
      saveStore(); syncChips();
      return;
    }
    const opt = e.target.closest('.qz-opt');
    if (opt){ answerOpt(+opt.dataset.k); return; }
  });
  const stage = $('qzStage');
  if (stage) stage.addEventListener('pointerdown', e => {
    if (!e.target.closest('#qzBoardSvg')) return;
    e.preventDefault();
    answerTap(e);
  });
  const go = $('qzGo');      if (go) go.addEventListener('click', startRound);
  const re = $('qzRetry');   if (re) re.addEventListener('click', startRound);
  const bk = $('qzBack');    if (bk) bk.addEventListener('click', () => { clearTimeout(QZ.timer); hideFx(); renderStart(); });
  const qt = $('qzQuit');    if (qt) qt.addEventListener('click', () => { clearTimeout(QZ.timer); hideFx(); renderStart(); });
  const ls = $('qzListen');  if (ls) ls.addEventListener('click', () => {
    const q = QZ.qs[QZ.i];
    if (q && q.type === 'board') playMidi(q.midi, 1.2);
  });
}
