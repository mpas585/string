/*
  omr/duration.js — 音価（長さ）の判定。符尾・旗・連桁・付点・タイを読む。

  音価は符頭の見た目だけでは決まらない。組み合わせで決まる:

    白玉 + 符尾なし              → 全音符   4拍
    白玉 + 符尾あり              → 2分音符  2拍
    黒玉 + 符尾あり + 旗/連桁 0本 → 4分音符  1拍
    黒玉 + 符尾あり + 旗/連桁 1本 → 8分音符  1/2拍
    黒玉 + 符尾あり + 旗/連桁 2本 → 16分音符 1/4拍
    以下、1本増えるごとに半分

    付点が1つ付くと 1.5倍、2つで 1.75倍。
    タイで結ばれた次の音符は、前の音符に足し込まれる（音としては1つになる）。

  旗と連桁は「符尾の先端の横に付く横向きの塊」という点で同じなので、
  数え方を分けていない。どちらも1本で音価が半分になる。

  ■ 対応していないこと
    休符。休符は符頭を持たないので notehead.js の出力に現れず、ここにも来ない。
    そのため「小節の中の音価の合計」は休符のぶんだけ足りなくなる。
    連符（3連符など）も見ていない。

  依存は notehead.js の帯ユーティリティのみ。
*/

import { components, cropStaffBand, eraseStaffLines } from './notehead.js';

/* ===== 帯の中の小物 ===== */

/** 局所座標で、その列の (x, y) から dir 方向へ続くインクの長さ */
function runFrom(ink, lw, lh, x, y, dir) {
  let n = 0;
  for (let yy = y; yy >= 0 && yy < lh; yy += dir) {
    if (!ink[yy * lw + x]) break;
    n++;
  }
  return n;
}

/** その画素を通る横方向のインクの長さ */
function hRun(ink, lw, x, y) {
  let a = x; while (a > 0 && ink[y * lw + a - 1]) a--;
  let b = x; while (b < lw - 1 && ink[y * lw + b + 1]) b++;
  return b - a + 1;
}

/* ===== 符尾 ===== */

/**
 * 符頭に付いている符尾を探す。
 * 符尾は符頭の右上か左下に付く。符頭の縁から少し内側の列を、上下それぞれ調べる。
 *
 * @returns {{has:boolean, dir:number, x:number, tipY:number, len:number}}
 *   dir … +1 = 上向き（符頭の右）, −1 = 下向き（符頭の左）。局所座標では上が y 小
 */
function findStem(ink, lw, lh, hx, hy, d, opts) {
  const { stemSide = 0.60, stemMinLen = 1.6, stemProbe = 0.30 } = opts;
  const best = { has: false, dir: 0, x: 0, tipY: 0, len: 0 };
  /* 右上（上向き符尾）と 左下（下向き符尾）の2通りを、数列ぶん幅を持たせて探す */
  const tries = [
    { sx: Math.round(hx + d * stemSide), dir: -1 },   /* 上向き＝yが小さくなる */
    { sx: Math.round(hx - d * stemSide), dir: +1 },   /* 下向き */
  ];
  const slack = Math.max(1, Math.round(d * stemProbe));
  for (const t of tries) {
    for (let dx = -slack; dx <= slack; dx++) {
      const x = t.sx + dx;
      if (x < 0 || x >= lw) continue;
      /* 符頭の高さから縦に伸びているか */
      const y0 = Math.round(hy);
      if (y0 < 0 || y0 >= lh || !ink[y0 * lw + x]) continue;
      const len = runFrom(ink, lw, lh, x, y0, t.dir);
      if (len < d * stemMinLen) continue;
      if (len > best.len) {
        best.has = true; best.dir = t.dir; best.x = x; best.len = len;
        best.tipY = y0 + t.dir * (len - 1);
      }
    }
  }
  return best;
}

/* ===== 旗・連桁 ===== */

/**
 * 符尾の脇に付いているものを数える。旗も連桁も1本で音価が半分になる。
 *
 * 帯（ある幅の中にインクがあるか）で数えてはいけない。実在フォントの旗は
 * この大きさでは太い曲線ではなく、符尾の先から符頭の近くまで下りてくる細い斜線で、
 * 帯で見ると符尾の全長にわたって1つの塊に繋がってしまい、8分も16分も区別できない。
 *
 * 符尾から一定距離の【1列だけ】を縦に見ると、旗の枚数だけインクの塊が現れる。
 * 実測（d=21）では 0.14d〜0.71d のどの距離でも 8分=1, 16分=2 と安定していた。
 * 距離を数通り試して最頻値を採る。連桁も符尾を横切るので同じ数え方で取れる。
 */
function countFlags(ink, lw, lh, stem, d, opts) {
  const { flagOffsets = [0.24, 0.33, 0.43, 0.52], flagSpan = 2.2, flagMin = 0.10 } = opts;
  const span = Math.round(d * flagSpan);
  const votes = [];

  for (const side of [+1, -1]) {
    for (const off of flagOffsets) {
      const x = stem.x + side * Math.max(1, Math.round(d * off));
      if (x < 0 || x >= lw) continue;
      let bands = 0, run = 0;
      for (let i = 0; i <= span; i++) {
        const y = stem.tipY - stem.dir * i;
        const on = i < span && y >= 0 && y < lh && ink[y * lw + x];
        if (on) { run++; continue; }
        if (run) { if (run >= d * flagMin) bands++; run = 0; }
      }
      votes.push(bands);
    }
  }
  if (!votes.length) return 0;
  /* 最頻値。0 は「その側には何も無い」なので、0以外があればそちらを優先する */
  const nz = votes.filter(v => v > 0);
  if (!nz.length) return 0;
  const count = {};
  for (const v of nz) count[v] = (count[v] || 0) + 1;
  return +Object.entries(count).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/* ===== 付点 ===== */

/**
 * 符頭の右にある付点を数える。
 *
 * 付点は「小さくて丸くて、何にも繋がっていない」のが決め手。
 * 高さだけで絞ると旗を拾ってしまう（旗は符尾の先にあるが、
 * 線上の音の付点は半間ぶん上にずれるので、縦の許容を狭くできない）。
 * そこで探索窓の中で連結成分を取り、窓の縁に触れない＝孤立した小さい塊だけを数える。
 * 旗や連桁は符尾に繋がっているので必ず窓の縁に触れ、ここで落ちる。
 */
function countDots(ink, lw, lh, hx, hy, d, opts) {
  const { dotFrom = 0.62, dotTo = 2.2, dotBand = 0.78, dotMin = 0.13, dotMax = 0.52 } = opts;
  const x0 = Math.max(0, Math.round(hx + d * dotFrom));
  const x1 = Math.min(lw - 1, Math.round(hx + d * dotTo));
  const y0 = Math.max(0, Math.round(hy - d * dotBand));
  const y1 = Math.min(lh - 1, Math.round(hy + d * dotBand));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw < 2 || bh < 2) return 0;

  const sub = new Uint8Array(bw * bh);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      sub[(y - y0) * bw + (x - x0)] = ink[y * lw + x] ? 1 : 0;

  let dots = 0;
  for (const c of components(sub, bw, bh, 3)) {
    if (c.x0 === 0 || c.y0 === 0 || c.x1 === bw - 1 || c.y1 === bh - 1) continue;  /* 何かに繋がっている */
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    if (cw < d * dotMin || cw > d * dotMax) continue;
    if (ch < d * dotMin || ch > d * dotMax) continue;
    dots++;
  }
  return Math.min(2, dots);
}

/* ===== タイ ===== */

/**
 * 同じ高さで隣り合う2つの符頭の間に弧があるか。
 * 弧は符頭の反対側（符尾が上なら下）に描かれるので、符頭の少し外側を見る。
 * スラー（違う高さを結ぶ）とは、同じ step であることで分けている。
 */
function hasTie(ink, lw, lh, a, b, d, opts) {
  const { tieNear = 0.35, tieFar = 1.95, tieCover = 0.55 } = opts;
  const x0 = Math.round(a.lx + d * 0.55), x1 = Math.round(b.lx - d * 0.55);
  if (x1 - x0 < d * 0.4) return false;
  /* 弧の高さは版によって違うので、決め打ちの位置ではなく
     符頭から 0.35d〜1.95d の帯のどこかにインクがあるか、で見る。
     符尾は1列しか占めないので、2つの符頭の間をずっと覆うことはない。
     連桁は符尾の先（3d以上先）なのでこの帯に入らない。 */
  const near = Math.round(d * tieNear), far = Math.round(d * tieFar);
  for (const side of [+1, -1]) {
    let hit = 0, total = 0;
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= lw) continue;
      total++;
      for (let k = near; k <= far; k++) {
        const y = Math.round(a.ly + side * k);
        if (y < 0 || y >= lh) break;
        if (ink[y * lw + x]) { hit++; break; }
      }
    }
    if (total && hit / total >= tieCover) return true;
  }
  return false;
}

/* ===== 本体 ===== */

/**
 * 符頭ごとに音価を決める。
 *
 * @param {Uint8Array} bin  1=インク（staff.js の binarize() の結果）
 * @param {number} w
 * @param {number} h
 * @param {Object} staffResult
 * @param {Object} noteheadResult
 * @param {Object} [opts]  各しきい値。すべて d 比
 * @returns {{heads:Array, summary:Object}}
 *   heads[] は符頭に次を足したもの:
 *     stem   … 符尾の有無と向き（+1=上向き, −1=下向き, 0=なし）
 *     flags  … 旗・連桁の本数
 *     dots   … 付点の数
 *     tie    … 次の音符へタイで繋がっているか
 *     dur    … 拍数（4分音符 = 1）
 */
export function detectDurations(bin, w, h, staffResult, noteheadResult, opts = {}) {
  const { maxFlags = 4 } = opts;
  const out = [];

  staffResult.staves.forEach((st, si) => {
    const d = st.d;
    const band = eraseStaffLines(cropStaffBand(bin, w, h, st), st, opts);
    const { ink, lw, lh, bx0, by0 } = band;
    const list = (noteheadResult.byStaff[si] || []).slice().sort((a, b) => a.x - b.x);

    /* 局所座標に直しておく */
    const local = list.map(n => ({ n, lx: n.x - bx0, ly: n.y - by0 }));

    const rows = local.map(({ n, lx, ly }) => {
      const stem = findStem(ink, lw, lh, lx, ly, d, opts);
      const flags = stem.has ? Math.min(maxFlags, countFlags(ink, lw, lh, stem, d, opts)) : 0;
      const dots = countDots(ink, lw, lh, lx, ly, d, opts);

      /* 基本の長さ */
      let dur;
      if (!n.filled) dur = stem.has ? 2 : 4;          /* 白玉：符尾があれば2分、無ければ全 */
      else dur = 1 / Math.pow(2, flags);              /* 黒玉：旗1本ごとに半分 */
      /* 付点 */
      if (dots === 1) dur *= 1.5;
      else if (dots >= 2) dur *= 1.75;

      return {
        ...n,
        stem: stem.has ? -stem.dir : 0,               /* 外向けは +1=上向き に揃える */
        stemLen: +(stem.len / d).toFixed(2),
        flags, dots, dur: +dur.toFixed(4), tie: false,
      };
    });

    /* タイ：同じ高さで隣り合う符頭の間に弧があるか */
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].step !== rows[i + 1].step) continue;
      if (rows[i + 1].x - rows[i].x > d * 12) continue;
      if (hasTie(ink, lw, lh, local[i], local[i + 1], d, opts)) rows[i].tie = true;
    }

    out.push(...rows);
  });

  const byDur = {};
  for (const r of out) byDur[r.dur] = (byDur[r.dur] || 0) + 1;
  return {
    heads: out,
    summary: {
      total: out.length,
      withStem: out.filter(r => r.stem !== 0).length,
      beamed: out.filter(r => r.flags > 0).length,
      dotted: out.filter(r => r.dots > 0).length,
      tied: out.filter(r => r.tie).length,
      byDur,
    },
  };
}

/**
 * タイで繋がった音符を1つにまとめる。
 * タイは「同じ高さの次の音符と繋げて1つの長さにする」記号なので、
 * 後ろの音符は消え、長さが前の音符に足される。
 */
export function mergeTies(heads) {
  const out = [];
  let i = 0;
  while (i < heads.length) {
    const cur = { ...heads[i] };
    while (cur.tie && i + 1 < heads.length &&
           heads[i + 1].step === heads[i].step && heads[i + 1].staff === heads[i].staff) {
      cur.dur = +(cur.dur + heads[i + 1].dur).toFixed(4);
      cur.tie = heads[i + 1].tie;
      i++;
    }
    out.push(cur);
    i++;
  }
  return out;
}
