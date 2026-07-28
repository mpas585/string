/*
  omr/barline.js — 小節線検出と小節番号付け。

  小節線が要る理由は2つある。
    1. 臨時記号（♯♭♮）は「その小節の間だけ有効」。小節の切れ目が分からないと、
       効力をどこで切るかが決められない。
    2. アプリ側が小節単位で動く（スライダー・ループ・小節フラッシュ）。

  見分け方:
    小節線は五線の第1線から第5線までを縦に埋める。
    ふつうの列は五線5本ぶんのインクしか無い（d=21なら10画素程度）ので、
    「五線の高さの9割以上がインク」という条件だけで十分に浮き上がる。

  符幹との区別:
    符幹も縦に長いが、
      ・符頭が横に付いているので、符頭のxとほぼ同じ位置にある
      ・五線の上下にはみ出すことが多い
    の2点で分かれる。符頭の位置は notehead.js が既に出しているので、それを使う。

  依存なし（二値画像と五線・符頭の結果を受け取るだけ）。
*/

/**
 * 段1つぶんの小節線を探す。
 *
 * @param {Uint8Array} bin  1=インク
 * @param {number} w
 * @param {number} h
 * @param {Object} st       staffResult.staves[i]
 * @param {Array} heads     その段の符頭（notehead.js の byStaff[i]）。符幹よけに使う
 * @param {Object} [opts]
 *   barCover   … 五線の高さのうちインクが占める割合の下限
 *   barMaxW    … 小節線とみなす太さの上限（d比）。終止線の太い方も拾えるようにする
 *   barOverhang… 五線の上下へはみ出してよい量（d比）。これを超えたら符幹とみなす
 *   barHeadGap … 符頭からこの距離（d比）以内にあるものは符幹とみなして捨てる
 *   barMerge   … この距離（d比）以内の候補は1本にまとめる（複縦線・終止線対策）
 * @returns {Array<{x:number, x0:number, x1:number, width:number, cover:number, thick:boolean}>}
 */
export function detectBarlines(bin, w, h, st, heads = [], opts = {}) {
  const {
    barCover = 0.88,
    barMaxW = 0.62,
    barOverhang = 0.75,
    barHeadGap = 0.85,
    barMerge = 0.9,
  } = opts;
  const d = st.d;
  const x0 = Math.max(0, st.x0), x1 = Math.min(w, st.x1);
  const height = st.lines[4] - st.lines[0];
  const need = height * barCover;

  /* 各列について、五線の範囲（傾きを戻した第1線〜第5線）のインク量を数える */
  const cover = new Float32Array(Math.max(0, x1 - x0));
  for (let x = x0; x < x1; x++) {
    const ya = Math.round(st.lines[0] + x * st.tan);
    const yb = Math.round(st.lines[4] + x * st.tan);
    if (ya < 0 || yb >= h || yb <= ya) continue;
    let n = 0;
    for (let y = ya; y <= yb; y++) if (bin[y * w + x]) n++;
    cover[x - x0] = n;
  }

  /* しきい値を超える列のかたまりを候補にする */
  const cands = [];
  let s = -1;
  for (let i = 0; i <= cover.length; i++) {
    const on = i < cover.length && cover[i] >= need;
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      const gx0 = x0 + s, gx1 = x0 + i - 1;
      let best = 0;
      for (let k = s; k < i; k++) if (cover[k] > best) best = cover[k];
      cands.push({ x0: gx0, x1: gx1, width: gx1 - gx0 + 1, cover: best / height });
      s = -1;
    }
  }

  /* 太すぎるもの、五線から大きくはみ出すもの、符頭に寄り添うものを落とす */
  const over = d * barOverhang;
  const out = [];
  for (const c of cands) {
    if (c.width > d * barMaxW) continue;
    const cx = Math.round((c.x0 + c.x1) / 2);
    /* 上下へのはみ出しを測る。符幹はここで落ちる */
    const ya = Math.round(st.lines[0] + cx * st.tan);
    const yb = Math.round(st.lines[4] + cx * st.tan);
    let up = 0, dn = 0;
    for (let y = ya - 1; y >= Math.max(0, ya - Math.round(over) - 2); y--) {
      if (!bin[y * w + cx]) break; up++;
    }
    for (let y = yb + 1; y <= Math.min(h - 1, yb + Math.round(over) + 2); y++) {
      if (!bin[y * w + cx]) break; dn++;
    }
    if (up > over || dn > over) continue;
    if (heads.some(n => Math.abs(n.x - cx) < d * barHeadGap)) continue;
    out.push({ x: cx, x0: c.x0, x1: c.x1, width: c.width, cover: +c.cover.toFixed(3), thick: c.width > d * 0.3 });
  }

  /* 近すぎる候補は1本にまとめる（複縦線・終止線は2本1組で書かれる） */
  const merged = [];
  for (const b of out) {
    const prev = merged[merged.length - 1];
    if (prev && b.x - prev.x < d * barMerge) {
      prev.x1 = b.x1; prev.x = Math.round((prev.x0 + prev.x1) / 2);
      prev.thick = prev.thick || b.thick;
      prev.double = true;
      continue;
    }
    merged.push({ ...b });
  }
  return merged;
}

/**
 * 全段の小節線を探し、符頭に小節番号を振る。
 *
 * 番号は段をまたいで通し。1から始める（弱起は考えない）。
 * 段の先頭にある縦線（システムの開始線）は、音部記号より左にあるので
 * startX を渡して除外する。
 *
 * @param {Uint8Array} bin
 * @param {Object} staffResult
 * @param {Object} noteheadResult
 * @param {Object} [opts]
 *   startX … 段ごとの「曲が始まるx」。pitch.js が調号の右端から出したものを渡す
 * @returns {{byStaff:Array, heads:Array, summary:Object}}
 *   heads[] は符頭に {measure} を足したもの
 */
export function detectMeasures(bin, w, h, staffResult, noteheadResult, opts = {}) {
  const { startX = null } = opts;
  const byStaff = staffResult.staves.map((st, si) => {
    const from = startX ? startX[si] : -Infinity;
    return detectBarlines(bin, w, h, st, noteheadResult.byStaff[si] || [], opts)
      .filter(b => b.x > from);
  });

  let measure = 1;
  const heads = [];
  staffResult.staves.forEach((st, si) => {
    const bars = byStaff[si];
    const list = (noteheadResult.byStaff[si] || []).slice().sort((a, b) => a.x - b.x);
    let bi = 0;
    for (const n of list) {
      while (bi < bars.length && bars[bi].x < n.x) { measure++; bi++; }
      heads.push({ ...n, measure });
    }
    /* 段の終わりに残っている線（行末の小節線）も数える */
    while (bi < bars.length) { measure++; bi++; }
  });

  return {
    byStaff, heads,
    summary: {
      total: byStaff.reduce((a, b) => a + b.length, 0),
      perStaff: byStaff.map(b => b.length),
      measures: measure,
    },
  };
}
