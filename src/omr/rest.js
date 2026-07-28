/*
  omr/rest.js — 休符の検出。

  休符は符頭を持たないので notehead.js の出力に一切現れない。
  そのため休符を別に拾わないと、小節の中の音価の合計が足りなくなり、
  songs.js に渡したときに後ろの音符が前へずれる。

  見分け方（実在フォントの記号を、五線に置いて消線まで通した後に実測した値。単位は d）:

    記号      幅    高    幅/高  中心の位置
    全休符   0.95  0.52  1.82   第4線から +0.21d（線からぶら下がる）
    2分休符  1.00  0.52  1.91   第3線から −0.21d（線の上に乗る）
    4分休符  0.90  2.76  0.33
    8分休符  0.95  1.67  0.57
    16分休符 1.19  2.52  0.47

  ・全休符と2分休符は横長（比 1.8 以上）で、他とはっきり分かれる。
    2つは形が同じで置く高さだけが違うので、五線に対する位置で分ける。
  ・残りは縦長。4分(2.76d)と16分(2.52d)は高さが近いので高さでは分けられない。
    8分(1.67d)だけが明らかに低いので、まず8分を高さで切り出す。
  ・4分と16分は幅で分ける。16分は鉤が2つあるぶん横に広い（1.19d 対 0.90d）。

  ※ 記号を単独で測った値をそのまま使ってはいけない。
     単独で測ると全休符の比は 3.40 だったが、五線に置いて消線を通すと 1.82 になる。
     五線と重なる部分の扱いで見かけの寸法が変わるため、
     しきい値は必ず「パイプラインを通した後」の値で決めること。

  ■ 紛らわしいもの
    臨時記号（♯ 0.71×2.05d、♭ 0.62×1.81d）は休符と大きさが重なる。
    臨時記号は必ず符頭のすぐ左に、同じ高さで付くので、その条件で除外している。
    符頭から離れた所に単独で立っている臨時記号は無いという前提。
*/

import { components, cropStaffBand, eraseStaffLines } from './notehead.js';

/** 音価（拍）。4分音符 = 1 */
export const REST_DUR = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

/**
 * 段ごとに休符を探す。
 *
 * @param {Uint8Array} bin
 * @param {number} w
 * @param {number} h
 * @param {Object} staffResult
 * @param {Object} noteheadResult
 * @param {Object} [opts]
 *   startX     … 段ごとの「曲が始まるx」。音部記号・調号を避けるため
 *   restHeadGap… 符頭がこの距離（d比）以内にあると符頭の一部とみなす
 *   accReach / accAlign … 臨時記号とみなす条件（右に符頭があり高さが揃う）
 * @returns {{rests:Array, byStaff:Array, summary:Object}}
 *   rests[] = {staff, x, y, x0, x1, kind, dur, w, h}
 */
export function detectRests(bin, w, h, staffResult, noteheadResult, opts = {}) {
  const {
    startX = null,
    restMinW = 0.45, restMaxW = 2.4,
    restMinH = 0.28, restMaxH = 3.3,
    restFlat = 1.35,           /* これ以上横長なら全休符か2分休符（実測 1.8 対 0.57） */
    restShort = 2.1,           /* これ未満の高さなら8分休符（実測 1.67 対 2.5〜2.8） */
    restWide = 1.05,           /* これ以上幅があれば16分（実測 1.19 対 0.90） */
    restHeadGap = 0.9,
    accReach = 2.6, accAlign = 0.75, accMaxW = 1.2, accMaxH = 2.45,
  } = opts;

  const byStaff = [];

  staffResult.staves.forEach((st, si) => {
    const d = st.d;
    const from = startX ? startX[si] : -Infinity;
    const heads = noteheadResult.byStaff[si] || [];
    const band = eraseStaffLines(cropStaffBand(bin, w, h, st), st, opts);
    const { ink, lw, lh, bx0, by0 } = band;
    const found = [];

    for (const c of components(ink, lw, lh, Math.max(6, Math.round(d * d * 0.03)))) {
      const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
      if (cw < d * restMinW || cw > d * restMaxW) continue;
      if (ch < d * restMinH || ch > d * restMaxH) continue;

      const gx0 = bx0 + c.x0, gx1 = bx0 + c.x1;
      const cx = (gx0 + gx1) / 2;
      if (cx < from) continue;                       /* 音部記号・調号の領域 */

      /* 符頭そのもの、または符頭にくっついている部分は除く */
      if (heads.some(n => n.x >= gx0 - d * restHeadGap && n.x <= gx1 + d * restHeadGap)) continue;

      /* 臨時記号は「すぐ右に、同じ高さの符頭がある」ので除く */
      const ycMid = (by0 + (c.y0 + c.y1) / 2) - cx * st.tan;
      if (cw <= d * accMaxW && ch <= d * accMaxH) {
        const isAcc = heads.some(n => {
          const dx = n.x - gx1;
          if (dx < 0 || dx > d * accReach) return false;
          return Math.abs((n.y - n.x * st.tan) - ycMid) <= d * accAlign;
        });
        if (isAcc) continue;
      }

      /* 分類 */
      let kind;
      if (cw / ch >= restFlat) {
        /* 全休符は第4線からぶら下がり（中心が線より下）、2分休符は第3線に乗る（中心が線より上）。
           それぞれの想定位置に近い方を採る。 */
        const toWhole = Math.abs(ycMid - (st.lines[1] + d * 0.21));
        const toHalf = Math.abs(ycMid - (st.lines[2] - d * 0.21));
        kind = toWhole <= toHalf ? 'whole' : 'half';
      } else if (ch < d * restShort) kind = 'eighth';
      else kind = (cw >= d * restWide) ? 'sixteenth' : 'quarter';

      found.push({
        staff: si, x: cx, y: by0 + (c.y0 + c.y1) / 2, x0: gx0, x1: gx1,
        kind, dur: REST_DUR[kind], w: cw, h: ch,
      });
    }

    found.sort((a, b) => a.x - b.x);
    byStaff.push(found);
  });

  const rests = byStaff.flat();
  const byKind = {};
  for (const r of rests) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  return {
    rests, byStaff,
    summary: { total: rests.length, byKind, perStaff: byStaff.map(l => l.length) },
  };
}
