/*
  metronome.js — メトロノーム（採点ゲームがあった場所）。

  画面（#metroView / includes/views/app.php）ひとつで完結する。指板は使わない。
    ・まん中の大きい数字がテンポ。＋−・スライダー・タップのどれでも変えられる
    ・拍子を選ぶと、拍のランプの数と、頭（1拍目）のアクセントが変わる
    ・ドラムモードに切り替えると、クリックの代わりにドラムのパターンで鳴る
      （ドラムモードのときだけビートを選べる）
    ・鳴らしているあいだは練習した時間に加わる（ST.metroOn を src/practice.js が見ている）

  拍の数え方は「1クリック＝1拍、間隔は 60/BPM 秒」で通してある。
  6/8 のような譜面の拍子でも、鳴る速さは画面の数字そのままになる（表示と音が食い違わない）。
  拍子の分母は、アクセントの付け方（3つごとに軽い頭を作るか）にだけ使う。

  音は他と同じ src/audio/synth.js を鳴らしているので、歯車の音量（メトロノーム／ドラム）が
  そのまま効く。音量プロファイルはスケール練習と同じものを使う（state.js の volProfileKey）。
*/

import { ST } from './state.js';
import { tt } from './util.js';
import { audio, makeBuses, NOISEBUF } from './audio/context.js';
import { metroClick, drKick, drSnare, drHat } from './audio/synth.js';
import { acquireWake, releaseWake } from './audio/scheduler.js';
/* 練習時間の数字はメトロノーム画面には出さない（練習カレンダーで見る）。
   加算そのものは src/practice.js が ST.metroOn を見て行うので、ここでは何もしない。 */

/* 選べる拍子。数字は「1小節あたりの拍数 / 拍の音符」 */
const SIGS = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8'];
/* 選べるビート（ドラムモード）。並び順はそのまま画面の並び順 */
const BEATS = ['eight', 'sixteen', 'four', 'shuffle', 'waltz'];

const BPM_MIN = 30, BPM_MAX = 260;

/* 先読み。scheduler.js ほど長く取らなくても、クリックは1音ずつなので詰まらない */
const LOOK = 0.20;    /* 秒：この先まで予約しておく */
const TICK = 25;      /* ms：予約を足しに行く間隔 */

/* 動いているあいだだけ持つもの */
let pumpTimer = 0;    /* 予約を足すタイマー */
let raf = 0;          /* ランプの点灯 */
let nextT = 0;        /* 次に鳴らす時刻（AudioContext の時計） */
let idx = 0;          /* 通し拍数。小節内の位置は idx % beats() */
let lamps = [];       /* [{i, t}] 鳴る予定。時刻が来たら光らせて捨てる */
let taps = [];        /* タップでテンポを決めるときの、たたいた時刻 */

const $ = (id) => document.getElementById(id);

/* ===== 今の設定（ST.metro に置いてある＝設定と一緒に保存・引き継ぎされる） ===== */
function M() {
  if (!ST.metro) ST.metro = { bpm: 80, sig: '4/4', drum: false, beat: 'eight' };
  return ST.metro;
}
function beatsOf(sig) { return Math.max(1, parseInt(String(sig).split('/')[0], 10) || 4); }
function unitOf(sig)  { return parseInt(String(sig).split('/')[1], 10) || 4; }
function beats() { return beatsOf(M().sig); }
/* 6/8・9/8・12/8 は3つずつのまとまりとして数えるので、頭以外にも軽いアクセントを置く */
function isCompound() { const m = M(); return unitOf(m.sig) === 8 && beatsOf(m.sig) % 3 === 0; }
function accentAt(i) {
  if (i === 0) return 'strong';
  if (isCompound() && i % 3 === 0) return 'weak';
  return '';
}

/* ===== 鳴らす ===== */
/* 1拍ぶん。ドラムモードのときは、その拍に置くドラムをまとめて予約する。
   t は AudioContext の時計での時刻（すでに先読みして決めてある）。 */
function fire(i, t) {
  const ctx = ST.ctx, B = ST.buses;
  if (!ctx || !B) return;
  const m = M();
  const spb = 60 / bpm();

  if (!m.drum) {
    /* 鳴らすのは1拍につき1回だけ。6/8 のような「3つずつのまとまり」の頭は、
       同じ音を重ねて鳴らすと音量だけ跳ね上がって耳につくので、
       音は普通のクリックのままにして、大きいランプ（.mt-lamp.acc）で示す。 */
    metroClick(ctx, B.metro, t, accentAt(i) === 'strong');
    return;
  }

  const n = beats();
  const last = (i === n - 1);
  const D = B.drum;
  switch (m.beat) {
    case 'sixteen':
      /* 16ビート。ハットを16分で刻む。裏拍の細かさで速さが分かりやすい */
      if (i % 2 === 0) drKick(ctx, D, t); else drSnare(ctx, D, t);
      for (let k = 0; k < 4; k++) drHat(ctx, D, t + spb * 0.25 * k, last && k === 3);
      break;
    case 'four':
      /* 4つ打ち。すべての拍にキック、裏にハット */
      drKick(ctx, D, t);
      if (i % 2 === 1) drSnare(ctx, D, t);
      drHat(ctx, D, t + spb * 0.5, last);
      break;
    case 'shuffle':
      /* シャッフル。ハットの裏を後ろへ寄せて跳ねさせる（3連の3つめ） */
      if (i % 2 === 0) drKick(ctx, D, t); else drSnare(ctx, D, t);
      drHat(ctx, D, t, false);
      drHat(ctx, D, t + spb * (2 / 3), last);
      break;
    case 'waltz':
      /* ワルツ。頭がキック、あとはスネア。拍ごとにハット */
      if (i === 0) drKick(ctx, D, t); else drSnare(ctx, D, t);
      drHat(ctx, D, t, last);
      break;
    default:
      /* 8ビート */
      if (i % 2 === 0) drKick(ctx, D, t); else drSnare(ctx, D, t);
      drHat(ctx, D, t, false);
      drHat(ctx, D, t + spb * 0.5, last);
      break;
  }
}

/* 先読みして予約を足す。テンポは毎回読み直すので、鳴らしたまま変えても次の拍から効く */
function pump() {
  const ctx = ST.ctx;
  if (!ctx || !ST.buses) { stopMetro(); return; }
  const until = ctx.currentTime + LOOK;
  let guard = 0;
  while (nextT < until && guard++ < 64) {
    const i = idx % beats();
    fire(i, nextT);
    lamps.push({ i: i, t: nextT, n: beats() });
    nextT += 60 / bpm();
    idx++;
  }
}

/* ランプ。予約した時刻を過ぎたものから点ける（音と目で見えるものをそろえる） */
function tickLamps() {
  raf = 0;
  const ctx = ST.ctx;
  if (!ST.metroOn || !ctx) return;
  const now = ctx.currentTime;
  let cur = -1, n = 0;
  while (lamps.length && lamps[0].t <= now) { cur = lamps[0].i; n = lamps[0].n; lamps.shift(); }
  if (cur >= 0) paintLamps(cur, n);
  raf = requestAnimationFrame(tickLamps);
}

/* ===== 画面 ===== */
function bpm() {
  const v = Math.round(M().bpm || 80);
  return Math.min(BPM_MAX, Math.max(BPM_MIN, v));
}

export function setBpm(v, quiet) {
  const m = M();
  m.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(v || 0)));
  const b = $('mtBpm'), r = $('mtRange');
  if (b) b.textContent = String(m.bpm);
  if (r && String(r.value) !== String(m.bpm)) r.value = String(m.bpm);
  if (!quiet) saveLater();
}

/* 拍のランプを作り直す（拍子を変えたときと、起動時） */
function buildLamps() {
  const box = $('mtLamps');
  if (!box) return;
  const n = beats();
  let html = '';
  for (let i = 0; i < n; i++) {
    const a = accentAt(i) ? ' acc' : '';
    html += `<span class="mt-lamp${a}"></span>`;
  }
  box.innerHTML = html;
}
function paintLamps(cur, n) {
  const box = $('mtLamps');
  if (!box) return;
  const els = box.children;
  if (els.length !== n) { buildLamps(); return; }
  for (let i = 0; i < els.length; i++) els[i].classList.toggle('hit', i === cur);
}
function clearLamps() {
  const box = $('mtLamps');
  if (!box) return;
  Array.from(box.children).forEach(e => e.classList.remove('hit'));
}

function buildChips() {
  const sig = $('mtSig');
  if (sig) {
    sig.innerHTML = SIGS.map(s => `<button type="button" data-sig="${s}">${s}</button>`).join('');
  }
  const bt = $('mtBeat');
  if (bt) {
    bt.innerHTML = BEATS.map(k =>
      `<button type="button" data-beat="${k}">${tt('ui.metro_beat_names.' + k)}</button>`).join('');
  }
  syncChips();
}
function syncChips() {
  const m = M();
  document.querySelectorAll('#mtSig button').forEach(b => b.classList.toggle('on', b.dataset.sig === m.sig));
  document.querySelectorAll('#mtBeat button').forEach(b => b.classList.toggle('on', b.dataset.beat === m.beat));
  const sw = $('mtDrumSw');
  if (sw) { sw.classList.toggle('on', !!m.drum); sw.setAttribute('aria-checked', m.drum ? 'true' : 'false'); }
  const wrap = $('mtBeatWrap');
  if (wrap) wrap.classList.toggle('off', !m.drum);
}

/* 設定の保存。つまみを動かすたびに書くと重いので、少し待ってからまとめて1回だけ書く */
let saveTimer = 0;
function saveLater() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    /* drawer.js を直接呼ぶと読み込みの輪ができるので、知らせだけ投げる
       （受け取って saveSettings() を呼ぶのは src/main.js） */
    try { window.dispatchEvent(new CustomEvent('gs:metrochanged')); } catch (e) {}
  }, 600);
}

/* ===== 開始・停止 ===== */
export function startMetro() {
  if (ST.metroOn) return;
  const ctx = audio();
  ST.ctx = ctx;
  ST.noise = NOISEBUF;               /* スネア・ハットはこのノイズを使う */
  ST.buses = makeBuses(ctx);
  ST.master = ST.buses.master;
  ST.metroOn = true;

  idx = 0; lamps = [];
  nextT = ctx.currentTime + 0.12;    /* 少し先から。押した瞬間に鳴らすと頭が欠ける */
  pump();
  pumpTimer = setInterval(pump, TICK);
  if (!raf) raf = requestAnimationFrame(tickLamps);
  acquireWake();
  syncPlayBtn();
}

export function stopMetro() {
  if (!ST.metroOn) { syncPlayBtn(); return; }
  ST.metroOn = false;
  if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = 0; }
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  lamps = [];
  clearLamps();

  /* 音を切る。ぶつ切りにすると「プツッ」と鳴るので、少し落としてから外す
     （やり方は scheduler.js の stopPlay と同じ） */
  if (ST.buses && ST.ctx) {
    const t = ST.ctx.currentTime, m = ST.buses.master, B = ST.buses;
    try {
      m.gain.cancelScheduledValues(t);
      m.gain.setValueAtTime(m.gain.value, t);
      m.gain.linearRampToValueAtTime(0.0001, t + 0.05);
    } catch (e) {}
    setTimeout(() => { try { m.disconnect(); if (B.conv) B.conv.disconnect(); if (B.limiter) B.limiter.disconnect(); } catch (e) {} }, 250);
  }
  ST.buses = null; ST.master = null;
  releaseWake();
  syncPlayBtn();
}

export function toggleMetro() { if (ST.metroOn) stopMetro(); else startMetro(); }

function syncPlayBtn() {
  const b = $('mtPlay');
  if (!b) return;
  b.classList.toggle('on', !!ST.metroOn);
  b.setAttribute('aria-label', tt(ST.metroOn ? 'ui.metro_stop' : 'ui.metro_start'));
}

/* モードに入ったとき／出るときに main.js・modes.js から呼ぶ */
export function enterMetro() {
  syncChips();
  buildLamps();
  setBpm(M().bpm, true);
  syncPlayBtn();
}

/* ===== タップでテンポ ===== */
const TAP_GAP = 2500;   /* これだけ間が空いたら数え直し（ms） */
function tap() {
  const now = (window.performance && performance.now) ? performance.now() : Date.now();
  if (taps.length && (now - taps[taps.length - 1]) > TAP_GAP) taps = [];
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length < 2) return;
  const span = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  if (span <= 0) return;
  const v = Math.round(60000 / span);
  if (v >= BPM_MIN && v <= BPM_MAX) setBpm(v);
}

/* ===== 起動時の配線 ===== */
export function initMetro() {
  if (!$('metroView')) return;      /* メトロノームを出していない画面（採点だけ等）では何もしない */
  buildChips();
  buildLamps();
  setBpm(M().bpm, true);
  syncPlayBtn();

  const sig = $('mtSig');
  if (sig) sig.addEventListener('click', e => {
    const b = e.target.closest('button[data-sig]');
    if (!b) return;
    M().sig = b.dataset.sig;
    idx = 0;                        /* 拍子を変えたら小節の頭から数え直す */
    syncChips(); buildLamps(); saveLater();
  });

  const bt = $('mtBeat');
  if (bt) bt.addEventListener('click', e => {
    const b = e.target.closest('button[data-beat]');
    if (!b) return;
    M().beat = b.dataset.beat;
    syncChips(); saveLater();
  });

  const sw = $('mtDrumSw');
  if (sw) {
    const flip = () => { M().drum = !M().drum; syncChips(); saveLater(); };
    sw.addEventListener('click', flip);
    sw.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    });
  }

  const dn = $('mtDown'), up = $('mtUp');
  if (dn) dn.addEventListener('click', () => setBpm(bpm() - 1));
  if (up) up.addEventListener('click', () => setBpm(bpm() + 1));

  const r = $('mtRange');
  if (r) r.addEventListener('input', () => setBpm(parseInt(r.value, 10)));

  const tp = $('mtTap');
  if (tp) tp.addEventListener('click', tap);

  const pl = $('mtPlay');
  if (pl) pl.addEventListener('click', toggleMetro);

  /* 画面を離れたら止める（裏で鳴り続けて、練習時間だけ増えるのを防ぐ） */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ST.metroOn) stopMetro();
  });
}
