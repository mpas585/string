/*
  omr/staff.js — 五線検出。
  決定的な画像処理のみで、推論・学習モデルは一切使わない。
  ここが土台になるので、結果が実行ごとに変わらないことを最優先にしている。

  手順:
    1. Otsu法で二値化（スキャンの濃さに自動追従）
    2. 垂直投影でノド（見開きの余白帯）を検出 → 段組を列に分割
       ※ 1ページ＝2ページ見開きのスキャンだと、全幅で水平投影しても左右の段が混ざって使えない
    3. 列ごとに傾きを推定（角度を振り、投影の鋭さが最大になる角度を選ぶ）
    4. 傾きを打ち消した水平投影 → 五線の候補行
    5. 間隔が揃う5本組だけを五線として確定する

  3が必須である理由:
    実測で 0.60° 傾いたスキャンがあった。列幅2195pxでは 23px のずれになり、
    五線の線間隔 20.75px を超える。補正なしだと投影のピークが 35% まで落ちて
    五線が1段も取れず、補正すると 99% まで戻った。1°未満でも致命的。

  座標系:
    staves[].lines は「傾きを打ち消した後」のy。実座標が要るときは staffLineY() を使う。

  依存なし（ImageData を受け取るだけ）。pdf.js / DOM / ST を参照しない。
*/

/* ===== 1. 二値化 ===== */

/** Otsu法のしきい値。戻り値 0–255。 */
export function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const n = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/**
 * ImageData → 二値画像。
 * @returns {{bin:Uint8Array, w:number, h:number, threshold:number}} bin は 1=インク, 0=地
 */
export function binarize(imageData, opts = {}) {
  const w = imageData.width, h = imageData.height;
  const d = imageData.data;
  const n = w * h;
  const gray = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    /* 輝度。アルファは PDF 描画時に白で埋めてある前提 */
    gray[i] = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
  }
  const threshold = opts.threshold != null ? opts.threshold : otsuThreshold(gray);
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = gray[i] < threshold ? 1 : 0;
  return { bin, w, h, threshold };
}

/* ===== 2. 列（見開きの分割） ===== */

/**
 * 垂直投影から本文の列を切り出す。
 * 譜面はどのx座標にも五線が通るので、ノドと外余白だけがインクゼロに近くなる。
 * 1°程度の傾きなら余白帯の幅に比べてずれが小さいので、ここは補正前で構わない。
 */
export function detectColumns(bin, w, h, opts = {}) {
  const {
    inkRatio = 0.004,    /* この割合未満のインクしかない列を「空」とみなす */
    minGapRatio = 0.02,  /* 空列がこの幅ぶん続いたらノドか外余白と判定 */
    minColRatio = 0.12,  /* これより細い列は破棄（ノイズ・ページ番号） */
  } = opts;

  const prof = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (bin[row + x]) prof[x]++;
  }

  const inkMin = Math.max(1, Math.floor(h * inkRatio));
  const minGap = Math.max(2, Math.floor(w * minGapRatio));
  const minCol = Math.floor(w * minColRatio);

  const cols = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const filled = x < w && prof[x] >= inkMin;
    if (filled && start < 0) start = x;
    if (!filled && start >= 0) {
      /* 空白がどれだけ続くか先読みして、区切りか単なる隙間かを決める */
      let gap = 0;
      while (x + gap < w && prof[x + gap] < inkMin) gap++;
      if (gap >= minGap || x + gap >= w) {
        if (x - start >= minCol) cols.push({ x0: start, x1: x });
        start = -1;
        x += gap - 1;
      }
    }
  }
  if (start >= 0 && w - start >= minCol) cols.push({ x0: start, x1: w });
  return cols.length ? cols : [{ x0: 0, x1: w }];
}

/* ===== 3. 傾き ===== */

/**
 * 傾きを打ち消した水平投影。
 * 実座標 y の点は、補正後の (y − x·tan) 行へ集計される。
 *
 * ⚠ 行(y)は絶対に間引かないこと。
 *   シフト量 sh = round(x·tan) の偶奇が x ごとに変わるため、y を1つおきに読むと
 *   書き込み先の行のパリティが列ごとにばらつき、偶数行と奇数行にピークが割れる。
 *   傾き0のときだけ全列のパリティが揃うので、間引きは「傾き0が最良」という
 *   誤った結論を作り出す。実際にこれで 0.60° を 0.000° と誤判定した。
 *   間引くなら列(stepX)だけにする。
 *
 * @param {number} stepX 列の間引き。推定時は粗く、確定時は 1
 */
export function shearedProfile(bin, w, h, x0, x1, tan, stepX = 1) {
  const prof = new Int32Array(h);
  for (let x = x0; x < x1; x += stepX) {
    const sh = Math.round(x * tan);
    for (let y = 0; y < h; y++) {
      if (bin[y * w + x]) {
        const yy = y - sh;
        if (yy >= 0 && yy < h) prof[yy]++;
      }
    }
  }
  return prof;
}

/** 投影の鋭さ。五線が1行に揃うほど大きくなる（二乗和） */
function sharpness(prof) {
  let s = 0;
  for (let i = 0; i < prof.length; i++) s += prof[i] * prof[i];
  return s;
}

/**
 * 列の傾きを推定する。粗く振ってから最良点の周りを細かく詰める。
 * @returns {{deg:number, tan:number}}
 */
export function estimateSkew(bin, w, h, x0, x1, opts = {}) {
  const {
    skewRange = 2.0,      /* 探索する角度の絶対値（度） */
    skewCoarse = 0.25,
    skewFine = 0.02,
    skewStepX = 4,        /* 列は間引いて良い（角度が分かれば十分）。行は間引かない */
  } = opts;
  const D2R = Math.PI / 180;
  const at = (deg) =>
    sharpness(shearedProfile(bin, w, h, x0, x1, Math.tan(deg * D2R), skewStepX));

  let best = -1, bestDeg = 0;
  for (let d = -skewRange; d <= skewRange + 1e-9; d += skewCoarse) {
    const s = at(d);
    if (s > best) { best = s; bestDeg = d; }
  }
  for (let d = bestDeg - skewCoarse; d <= bestDeg + skewCoarse + 1e-9; d += skewFine) {
    const s = at(d);
    if (s > best) { best = s; bestDeg = d; }
  }
  return { deg: bestDeg, tan: Math.tan(bestDeg * D2R) };
}

/* ===== 4–5. 五線 ===== */

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 傾き補正後の水平投影から、五線の候補行を拾う。 */
function lineCandidates(bin, w, h, x0, x1, tan, opts) {
  const { lineRatio = 0.5, maxThickRatio = 0.02 } = opts;
  const prof = shearedProfile(bin, w, h, x0, x1, tan, 1);
  const need = Math.max(3, Math.floor((x1 - x0) * lineRatio));
  const maxThick = Math.max(2, Math.floor(h * maxThickRatio));

  const out = [];
  let run = -1;
  for (let y = 0; y <= h; y++) {
    const isLine = y < h && prof[y] >= need;
    if (isLine && run < 0) run = y;
    if (!isLine && run >= 0) {
      const thick = y - run;
      /* 太すぎる帯は五線ではない（黒ベタ・罫線・裏写りのかたまり） */
      if (thick <= maxThick) out.push({ y: (run + y - 1) / 2, thick });
      run = -1;
    }
  }
  return out;
}

/** 候補行を「間隔の揃った5本組」にまとめる。 */
function groupStaves(cands, opts) {
  const { spacingTol = 0.25, minSpacing = 3 } = opts;
  const staves = [];
  let i = 0;
  while (i + 4 < cands.length) {
    const five = cands.slice(i, i + 5);
    const gaps = [];
    for (let k = 1; k < 5; k++) gaps.push(five[k].y - five[k - 1].y);
    const d = median(gaps);
    const ok = d >= minSpacing && gaps.every((g) => Math.abs(g - d) <= spacingTol * d);
    if (ok) {
      staves.push({ lines: five.map((c) => c.y), d, thick: median(five.map((c) => c.thick)) });
      i += 5;
    } else {
      i += 1;
    }
  }
  return staves;
}

/**
 * 五線検出の本体。
 * @param {ImageData} imageData  pdf.js の renderPageForOmr() が返すもの
 * @param {Object} [opts]        各しきい値。skew:false で傾き推定を省略できる
 * @returns {{w,h,threshold,columns,staves,summary}}
 *   staves[] = {col, x0, x1, lines:[y×5], d, tan, skewDeg, top, bottom}
 *   lines は傾き補正後のy。実座標は staffLineY() で得る
 *   d = 五線の線間隔。符頭の大きさ・音高1度ぶんの高さ(d/2) の基準になる
 */
export function detectStaves(imageData, opts = {}) {
  const { bin, w, h, threshold } = binarize(imageData, opts);
  const columns = detectColumns(bin, w, h, opts);

  const staves = [];
  const colInfo = [];
  columns.forEach((c, ci) => {
    const sk = (opts.skew === false)
      ? { deg: 0, tan: 0 }
      : estimateSkew(bin, w, h, c.x0, c.x1, opts);
    colInfo.push({ x0: c.x0, x1: c.x1, skewDeg: sk.deg, tan: sk.tan });

    const cands = lineCandidates(bin, w, h, c.x0, c.x1, sk.tan, opts);
    for (const s of groupStaves(cands, opts)) {
      staves.push({
        col: ci,
        x0: c.x0,
        x1: c.x1,
        lines: s.lines,
        d: s.d,
        thick: s.thick,
        tan: sk.tan,
        skewDeg: sk.deg,
        /* 加線ぶんの余裕。符頭は五線の外にも出るので上下に4度ぶん広げておく */
        top: s.lines[0] - 4 * s.d,
        bottom: s.lines[4] + 4 * s.d,
      });
    }
  });

  const ds = staves.map((s) => s.d);
  return {
    w, h, threshold,
    columns: colInfo,
    staves,
    summary: {
      columns: colInfo.length,
      staves: staves.length,
      skew: colInfo.map((c) => +c.skewDeg.toFixed(3)),
      spacing: ds.length ? { min: Math.min(...ds), med: median(ds), max: Math.max(...ds) } : null,
    },
  };
}

/** 五線の第i線が、実座標の x でどの y を通るか。 */
export function staffLineY(staff, i, x) {
  return staff.lines[i] + x * staff.tan;
}

/* ===== 検出結果の可視化（調整用。本番UIには不要） ===== */

/**
 * 検出結果を canvas に重ねて描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} result  detectStaves() の戻り値
 * @param {number} [scale] 表示canvasが検出画像の何倍か（縮小表示なら 1未満）
 */
export function drawOverlay(ctx, result, scale = 1) {
  const S = (v) => v * scale;
  ctx.save();
  ctx.lineWidth = 1;

  /* 列 */
  ctx.strokeStyle = 'rgba(70,130,255,0.9)';
  ctx.setLineDash([6, 4]);
  for (const c of result.columns) ctx.strokeRect(S(c.x0), 0.5, S(c.x1 - c.x0), S(result.h) - 1);
  ctx.setLineDash([]);

  /* 五線。補正を戻して実際の傾きのまま描く */
  result.staves.forEach((s, i) => {
    ctx.fillStyle = 'rgba(0,200,120,0.10)';
    ctx.beginPath();
    ctx.moveTo(S(s.x0), S(s.top + s.x0 * s.tan));
    ctx.lineTo(S(s.x1), S(s.top + s.x1 * s.tan));
    ctx.lineTo(S(s.x1), S(s.bottom + s.x1 * s.tan));
    ctx.lineTo(S(s.x0), S(s.bottom + s.x0 * s.tan));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,40,40,0.85)';
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      ctx.moveTo(S(s.x0), S(staffLineY(s, k, s.x0)) + 0.5);
      ctx.lineTo(S(s.x1), S(staffLineY(s, k, s.x1)) + 0.5);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,40,40,0.95)';
    ctx.font = '11px monospace';
    ctx.fillText(`${i}  d=${s.d.toFixed(1)}`, S(s.x0) + 3, S(staffLineY(s, 0, s.x0)) - 4);
  });
  ctx.restore();
}
