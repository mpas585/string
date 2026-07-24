/*
  omr/pitch.js — 音高判定。notehead.js が出した段数(step)を MIDI に変換する。

  step は「五線上のどこにあるか」でしかない。音名にするには
    1. 音部記号（どの線が何の音か）
    2. 調号（どの音名が半音上下するか）
  の2つが要る。この2つを段ごとに求めて、step → MIDI を確定させるのがこのファイル。

  ■ 対応していないこと（承知の上での区切り）
    臨時記号（音符の直前に付く ♯♭♮）は扱わない。臨時記号は「その小節の間だけ有効」
    という規則なので、小節線検出ができるまで正しく適用できない。中途半端に音符単位で
    適用すると、小節をまたいだ所で必ず誤る。小節線が入るまでは調号のみを適用する。
    → 半音変化を含む曲では、その音だけ半音ずれた値が出る。

  ■ step の約束（notehead.js と同じ）
    第1線（いちばん下の線）が 0。上へ 1 ずつ。1段 = d/2。

  依存は notehead.js の帯ユーティリティのみ。DOM も ST も参照しない。
*/

import { binarize } from './staff.js';
import { components, cropStaffBand, eraseStaffLines } from './notehead.js';

/* ===== 音名まわり（ここは規則なので厳密に決まる） ===== */

/* 白鍵だけを数えた度数 → C からの半音数 */
const DEG_SEMI = [0, 2, 4, 5, 7, 9, 11];
const LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** 白鍵通し番号（C4 = 0、上が正）→ MIDI */
export function midiOfDiatonic(di) {
  const oct = Math.floor(di / 7);
  const deg = ((di % 7) + 7) % 7;
  return 60 + oct * 12 + DEG_SEMI[deg];
}
/** 白鍵通し番号 → 音名（C/D/E…） */
export function letterOfDiatonic(di) {
  return LETTER[((di % 7) + 7) % 7];
}

/**
 * 音部記号の定義。
 *  baseDi … step 0（第1線）に来る音の白鍵通し番号（C4=0）
 *  height … 記号の縦の広がり（d単位）の目安
 *  center … ハ音記号のとき、記号の上下中心が来る線。第5線を0、下向き正（第3線=2, 第4線=1）
 *
 * 判定に「上端・下端が五線のどこか」を使わないのは、そこがフォント依存だから。
 * 実際に FreeSerif の音楽記号を測ったところ、ベースラインが基準線に一致せず、
 * 4種とも五線に対して大きく上へずれた。一方【縦の広がり】は浄書の約束どおりで、
 *   ヘ音 3.0d ＜ ハ音 4.1d ＜ ト音 6.2d
 * と十分に離れていた。高さは d で正規化されるので拡大率にも依存しない。
 * アルトとテノールは同じ形・同じ高さなので、そこだけ位置で分ける。
 * ハ音記号は上下対称なので「外接矩形の中心＝基準線」は幾何的に保証される。
 */
export const CLEFS = {
  /* ト音：第2線が G4 */
  treble: { baseDi: 2,   height: 6.4 },
  /* ヘ音：第4線が F3 */
  bass:   { baseDi: -10, height: 3.2 },
  /* アルト：第3線が C4 */
  alto:   { baseDi: -4,  height: 4.2, center: 2.0 },
  /* テノール：第4線が C4 */
  tenor:  { baseDi: -6,  height: 4.2, center: 1.0 },
};

/** 調号の並び順（この順にしか増えない） */
export const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/**
 * step → MIDI。
 * @param {number} step   第1線を0とした段数
 * @param {string} clef   'treble' | 'bass' | 'alto' | 'tenor'
 * @param {Object} [key]  detectKeySignature() の戻り値。省略時はハ長調
 */
export function stepToMidi(step, clef, key) {
  const c = CLEFS[clef] || CLEFS.bass;
  const di = c.baseDi + step;
  let midi = midiOfDiatonic(di);
  if (key && key.count) {
    const order = key.sign > 0 ? SHARP_ORDER : FLAT_ORDER;
    if (order.slice(0, key.count).includes(letterOfDiatonic(di))) midi += key.sign;
  }
  return midi;
}

/** MIDI → 科学的音名（C4 / F#3）。♯表記に寄せる */
export function nameOfMidi(midi) {
  const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return N[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/* ===== 段の先頭にある記号を切り出す ===== */

/**
 * 帯の中の連結成分を、実座標と五線相対の位置に直して返す。
 * @returns {Array<{x0,x1,ycTop,ycBot,w,h,n,ink}>}  yc は傾きを戻したy
 */
function glyphsInBand(band, st, minW, minH) {
  const { ink, lw, lh, bx0, by0 } = band;
  const out = [];
  for (const c of components(ink, lw, lh, 6)) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (w < minW || h < minH) continue;
    /* 傾きを戻す。左右端それぞれで戻して上下端を取る */
    const gx0 = bx0 + c.x0, gx1 = bx0 + c.x1;
    const ycTop = (by0 + c.y0) - ((gx0 + gx1) / 2) * st.tan;
    const ycBot = (by0 + c.y1) - ((gx0 + gx1) / 2) * st.tan;
    out.push({ x0: gx0, x1: gx1, ycTop, ycBot, w, h, n: c.n });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

/* ===== 音部記号 ===== */

/**
 * 段の先頭の記号から音部記号を判定する。
 *
 * 4種は縦の広がりが大きく違うので、上端・下端の位置だけで分けられる:
 *   ト音   五線の上へも下へも大きくはみ出す（全高 6.5d ほど）
 *   ヘ音   五線の上半分に収まる（全高 3.2d ほど、第1線まで届かない）
 *   アルト 五線をちょうど覆う（全高 4d）
 *   テノール アルトと同じ形が 1d 上にずれる
 *
 * 小節線を記号と間違えないよう、細い縦棒（幅 0.25d 未満）は候補から外す。
 *
 * @returns {{clef:string, score:number, margin:number, box:Object|null}}
 *   margin … 2位との差（d単位）。小さいほど怪しい。0.4 未満なら手動で確認したい
 */
export function detectClef(bin, w, h, st, opts = {}) {
  const { clefWindow = 3.0, clefBassMax = 3.8, clefTrebleMin = 5.3 } = opts;
  const d = st.d;
  const band = eraseStaffLines(cropStaffBand(bin, w, h, st), st, opts);
  const glyphs = glyphsInBand(band, st, Math.round(d * 0.25), Math.round(d * 1.2));
  if (!glyphs.length) return { clef: 'bass', score: 0, margin: 0, box: null };

  /* 先頭の記号の塊。窓の中にある成分をまとめて1つの外接矩形にする
     （ヘ音の2つの点、ト音が線消しで分断された場合などをまとめるため） */
  const x0 = glyphs[0].x0;
  const win = glyphs.filter(g => g.x0 < x0 + d * clefWindow);
  const box = {
    x0: Math.min(...win.map(g => g.x0)),
    x1: Math.max(...win.map(g => g.x1)),
    ycTop: Math.min(...win.map(g => g.ycTop)),
    ycBot: Math.max(...win.map(g => g.ycBot)),
  };

  /* 五線の第5線を 0、下向き正、単位 d に正規化 */
  const top = (box.ycTop - st.lines[0]) / d;
  const bot = (box.ycBot - st.lines[0]) / d;
  const height = bot - top;
  const center = (top + bot) / 2;

  let clef, margin;
  if (height < clefBassMax) {
    clef = 'bass';
    margin = clefBassMax - height;                    /* 境界までの余裕 */
  } else if (height < clefTrebleMin) {
    /* ハ音記号。上下対称なので中心が基準線。第3線(2d)ならアルト、第4線(1d)ならテノール */
    clef = Math.abs(center - CLEFS.alto.center) <= Math.abs(center - CLEFS.tenor.center)
      ? 'alto' : 'tenor';
    margin = Math.min(height - clefBassMax, clefTrebleMin - height,
                      Math.abs(Math.abs(center - CLEFS.alto.center) - Math.abs(center - CLEFS.tenor.center)));
  } else {
    clef = 'treble';
    margin = height - clefTrebleMin;
  }

  return {
    clef,
    height: +height.toFixed(2),
    center: +center.toFixed(2),
    margin: +margin.toFixed(3),
    box: { ...box, top: +top.toFixed(2), bottom: +bot.toFixed(2) },
  };
}

/* ===== 調号 ===== */

/**
 * 音部記号の直後にある ♯ / ♭ を数える。
 *
 * ♯と♭の区別は、外接矩形の中でインクがどこに寄っているかで付ける。
 *   ♭ は下半分が袋状に太く、上半分は細い縦棒だけ → 上部のインク密度が低い
 *   ♯ は上下対称に横棒が2本入る → 上部にもインクがある
 * 調号は同じ記号しか並ばないので、多数決で符号を決める。
 *
 * @returns {{count:number, sign:number, altered:string[], steps:number[], glyphs:number}}
 *   sign … +1=♯ / −1=♭ / 0=調号なし
 *   endX … 調号の右端（実座標x）。ここより左にある「符頭」は記号の一部なので捨てる
 */
export function detectKeySignature(bin, w, h, st, clefBox, opts = {}) {
  const { keyWindow = 6.0, keyTopBand = 0.35, keyTopInk = 0.26 } = opts;
  const d = st.d;
  const band = eraseStaffLines(cropStaffBand(bin, w, h, st), st, opts);
  const { ink, lw, bx0 } = band;

  const from = clefBox ? clefBox.x1 + d * 0.35 : bx0;
  const to = from + d * keyWindow;
  /* 高さの上限は 3.4d。実測（FreeSerif）で ♯ が 2.05d、♭ が 1.81d だったので余裕を見る。
     ここを 3.0d にしていたとき、少し大きめに組まれた ♯ が全部こぼれて調号なしになった。 */
  const glyphs = glyphsInBand(band, st, Math.round(d * 0.35), Math.round(d * 1.15))
    .filter(g => g.x0 >= from && g.x1 <= to && g.w <= d * 1.5 && g.h <= d * 3.4);

  const endX0 = clefBox ? clefBox.x1 : bx0;
  if (!glyphs.length) return { count: 0, sign: 0, altered: [], steps: [], glyphs: 0, endX: endX0 };

  let sharps = 0, flats = 0;
  const steps = [];
  for (const g of glyphs) {
    /* 外接矩形の上 35% にどれだけインクがあるか */
    const gy0 = Math.round(g.ycTop + ((g.x0 + g.x1) / 2) * st.tan) - band.by0;
    const hh = Math.max(1, Math.round(g.h * keyTopBand));
    let top = 0, area = 0;
    for (let y = gy0; y < gy0 + hh; y++) {
      if (y < 0 || y >= band.lh) continue;
      for (let x = g.x0 - bx0; x <= g.x1 - bx0; x++) {
        if (x < 0 || x >= lw) continue;
        area++;
        if (ink[y * lw + x]) top++;
      }
    }
    const ratio = area ? top / area : 0;
    if (ratio < keyTopInk) flats++; else sharps++;
    /* 記号の中心が指す段。♯は中心、♭は袋の中心が音の位置 */
    const yc = (ratio < keyTopInk) ? (g.ycTop + g.ycBot * 2) / 3 : (g.ycTop + g.ycBot) / 2;
    steps.push(Math.round((st.lines[4] - yc) / (d / 2)));
  }

  const sign = sharps >= flats ? 1 : -1;
  const count = Math.min(7, glyphs.length);
  const order = sign > 0 ? SHARP_ORDER : FLAT_ORDER;
  return {
    count, sign, altered: order.slice(0, count), steps, glyphs: glyphs.length,
    endX: Math.max(endX0, ...glyphs.map(g => g.x1)),
  };
}

/* ===== まとめ ===== */

/**
 * 段ごとに音部記号と調号を決め、符頭に MIDI を入れる。
 *
 * @param {ImageData} imageData
 * @param {Object} staffResult    detectStaves() の戻り値
 * @param {Object} noteheadResult detectNoteheads() の戻り値
 * @param {Object} [opts]
 *   clefOverride … 段番号→音部記号名。自動判定を上書きする（'bass' など）
 *                  すべての段に同じものを使うなら文字列1つでもよい
 *   keyOverride  … {count, sign} を直接指定する
 *   detectKey:false … 調号検出をやめてハ長調として扱う
 * @returns {{staves:Array, heads:Array, summary:Object}}
 *   heads[] は notehead.js の要素に {midi, name, clef} を足したもの
 */
export function assignPitches(imageData, staffResult, noteheadResult, opts = {}) {
  const { clefOverride = null, keyOverride = null, detectKey = true, headGapAfterKey = 0.6 } = opts;
  const { bin, w, h } = binarize(imageData, opts);

  const staves = staffResult.staves.map((st, si) => {
    const forced = (typeof clefOverride === 'string') ? clefOverride
                 : (clefOverride && clefOverride[si]) || null;
    const det = detectClef(bin, w, h, st, opts);
    const clef = forced || det.clef;
    const key = keyOverride ? { ...keyOverride, altered: (keyOverride.sign > 0 ? SHARP_ORDER : FLAT_ORDER).slice(0, keyOverride.count) }
              : (detectKey ? detectKeySignature(bin, w, h, st, det.box, opts)
                           : { count: 0, sign: 0, altered: [], steps: [], glyphs: 0 });
    return { staff: si, clef, forced: !!forced, detected: det, key };
  });

  /* 音部記号や調号は符頭検出から見ると「丸くて太いもの」なので、
     ♭の袋やヘ音記号の玉が符頭として拾われている。曲が始まる位置より左は捨てる。
     この判断は調号の右端が分かって初めてできるので、ここでやる。 */
  const startX = staves.map(s => {
    const base = (s.key && s.key.endX != null) ? s.key.endX
               : (s.detected.box ? s.detected.box.x1 : 0);
    return base + staffResult.staves[s.staff].d * headGapAfterKey;
  });
  const dropped = noteheadResult.heads.filter(n => n.x < startX[n.staff]).length;

  const heads = noteheadResult.heads.filter(n => n.x >= startX[n.staff]).map(n => {
    const s = staves[n.staff];
    const midi = stepToMidi(n.step, s.clef, s.key);
    return { ...n, clef: s.clef, midi, name: nameOfMidi(midi) };
  });

  const mids = heads.map(n => n.midi);
  return {
    staves, heads,
    summary: {
      clefs: staves.map(s => s.clef),
      keys: staves.map(s => (s.key.count ? `${s.key.count}${s.key.sign > 0 ? '♯' : '♭'}` : '—')),
      range: mids.length ? { min: Math.min(...mids), max: Math.max(...mids) } : null,
      dropped,                    /* 記号の一部だったので捨てた符頭の数 */
      lowConfidence: staves.filter(s => !s.forced && s.detected.margin < 0.4).map(s => s.staff),
    },
  };
}
