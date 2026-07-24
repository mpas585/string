/*
  omr/notehead.js — 符頭検出。staff.js が出した五線の上で符頭を拾う。
  staff.js と同じ方針で、決定的な画像処理のみ。推論・学習モデルは使わない。

  基準単位は五線の線間隔 d（staff.js が段ごとに実測した値）。
  楽譜の寸法はすべて d に比例するので、解像度もスキャン倍率も d に吸収される。
  ここで px を直に書かないこと。

  手順（段ごとに、その段の帯だけを切り出して処理する）:
    1. 五線を消す。ただし縦方向のインクが薄い所だけ。
       符頭・符幹が線を跨いでいる所は縦に厚いので残る。
    2. 各画素について、そこを通る横方向と縦方向のインクの連続長を数える。
    3. 距離変換で「そこに入る最大の円の半径」を出す。
       符頭は約 0.5d、連桁は 0.25d、符幹は 0.06d。0.38d で切れば符頭だけが残る。
    4. 残りを連結成分にまとめ、重心を符頭の中心とする（4分・8分などの黒玉）。
    5. 白玉（2分・全音符）は芯が無いので別口。囲まれた白領域＝穴を探す。
    6. 中心のyから、五線に対する段数(step)を出す。

  出力の step:
    第1線（いちばん下の線）を 0 とし、上へ 1 ずつ増える。1段 = d/2。
    第1間=1、第2線=2 … 第5線=8。下加線の音は負。
    ※ これは五線上の位置であって音高ではない。音名にするには音部記号と調号が要る。
      それは次の工程（音高判定）の仕事で、ここではやらない。

  依存なし（ImageData と detectStaves() の結果を受け取るだけ）。
*/

import { binarize } from './staff.js';

/* ===== 小物 ===== */

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 連結成分のラベリング（8近傍）。明示スタックで再帰は使わない。
 * @param {Uint8Array} mask 1=対象画素
 * @returns {Array<{n:number,sx:number,sy:number,x0:number,y0:number,x1:number,y1:number}>}
 *          n=画素数, sx/sy=座標の総和（重心用）, x0..y1=外接矩形
 */
export function components(mask, lw, lh, minPixels) {
  const seen = new Uint8Array(lw * lh);
  const stack = new Int32Array(lw * lh);
  const out = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let n = 0, sx = 0, sy = 0;
    let x0 = lw, y0 = lh, x1 = -1, y1 = -1;
    while (sp) {
      const p = stack[--sp];
      const px = p % lw, py = (p - px) / lw;
      n++; sx += px; sy += py;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= lh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= lw) continue;
          const q = ny * lw + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    if (n >= minPixels) out.push({ n, sx, sy, x0, y0, x1, y1 });
  }
  return out;
}

/** 外側と繋がっている白領域を潰し、囲まれた穴だけを残すための境界判定 */
function touchesEdge(c, lw, lh) {
  return c.x0 === 0 || c.y0 === 0 || c.x1 === lw - 1 || c.y1 === lh - 1;
}

/* ===== 段ごとの帯を切り出す ===== */

/**
 * 段の帯（加線ぶんを含む上下範囲）を、傾きを戻した実座標で切り出す。
 * staff.lines は傾き補正後のyなので、実座標では y = lines + x·tan。
 * @returns {{ink:Uint8Array, lw:number, lh:number, bx0:number, by0:number}}
 */
export function cropStaffBand(bin, w, h, st) {
  const bx0 = Math.max(0, st.x0);
  const bx1 = Math.min(w, st.x1);
  const lw = bx1 - bx0;
  /* 帯の実座標。傾きぶん左右の端で上下する */
  const yA = st.top + bx0 * st.tan, yB = st.top + bx1 * st.tan;
  const yC = st.bottom + bx0 * st.tan, yD = st.bottom + bx1 * st.tan;
  const by0 = Math.max(0, Math.floor(Math.min(yA, yB)) - 1);
  const by1 = Math.min(h, Math.ceil(Math.max(yC, yD)) + 1);
  const lh = Math.max(0, by1 - by0);

  const ink = new Uint8Array(lw * lh);
  for (let ly = 0; ly < lh; ly++) {
    const y = by0 + ly;
    const grow = y * w;
    const lrow = ly * lw;
    for (let lx = 0; lx < lw; lx++) {
      if (!bin[grow + bx0 + lx]) continue;
      /* 傾きを戻したyが帯の内側にあるものだけ採る */
      const yc = y - (bx0 + lx) * st.tan;
      if (yc < st.top || yc > st.bottom) continue;
      ink[lrow + lx] = 1;
    }
  }
  return { ink, lw, lh, bx0, by0 };
}

/**
 * 五線を消す。縦のインクが薄い所だけを消すので、
 * 符頭・符幹・連桁が線を跨いでいる部分は残る。
 */
export function eraseStaffLines(band, st, opts) {
  const { lineKeepRatio = 1.9 } = opts;
  const { ink, lw, lh, bx0, by0 } = band;
  /* 消してよい縦の厚み。線の実測太さの数倍まで（太さが取れていなければ d の1/4） */
  const maxThick = Math.max(2, Math.round((st.thick || st.d * 0.12) * lineKeepRatio));

  for (let k = 0; k < 5; k++) {
    for (let lx = 0; lx < lw; lx++) {
      const x = bx0 + lx;
      const ly = Math.round(st.lines[k] + x * st.tan) - by0;
      if (ly < 0 || ly >= lh) continue;
      if (!ink[ly * lw + lx]) continue;
      /* この画素を含む縦の連続を測る */
      let a = ly; while (a > 0 && ink[(a - 1) * lw + lx]) a--;
      let b = ly; while (b < lh - 1 && ink[(b + 1) * lw + lx]) b++;
      if (b - a + 1 <= maxThick) {
        for (let y = a; y <= b; y++) ink[y * lw + lx] = 0;
      }
    }
  }
  return band;
}

/* ===== 距離変換 ===== */

/**
 * インクの各画素から、いちばん近い地までの距離。
 * 3-4 チャンファーの2パス（前向き・後ろ向き）。値は3倍で持ち、最後に3で割る。
 *
 * ここで距離変換を使う理由：
 *   符頭の中に入る最大の円の半径は短半径ぶん＝約 0.5d。
 *   連桁は厚み 0.5d なので半径 0.25d、符幹は太さ 0.12d なので半径 0.06d しかない。
 *   つまり「半径 0.38d 以上」で符頭だけが残り、連桁との差が2倍ある。
 *
 * ⚠ 矩形の収縮で代用すると余裕が無い。符頭は【傾いた楕円】なので、
 *   内接する軸並行の矩形は見た目よりずっと小さい。実際 0.80d×0.58d の収縮では、
 *   二値化のしきい値が数段変わって輪郭が1px痩せただけで符頭が全滅した。
 *   （しきい値156で拾えたものが125で0個になった）
 */
function distanceTransform(ink, lw, lh) {
  const INF = 1 << 28;
  const dt = new Int32Array(lw * lh);
  for (let i = 0; i < dt.length; i++) dt[i] = ink[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= lw || y >= lh) ? 0 : dt[y * lw + x];
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const i = y * lw + x;
      if (!dt[i]) continue;
      let v = dt[i];
      v = Math.min(v, at(x - 1, y) + 3, at(x - 1, y - 1) + 4, at(x, y - 1) + 3, at(x + 1, y - 1) + 4);
      dt[i] = v;
    }
  }
  for (let y = lh - 1; y >= 0; y--) {
    for (let x = lw - 1; x >= 0; x--) {
      const i = y * lw + x;
      if (!dt[i]) continue;
      let v = dt[i];
      v = Math.min(v, at(x + 1, y) + 3, at(x + 1, y + 1) + 4, at(x, y + 1) + 3, at(x - 1, y + 1) + 4);
      dt[i] = v;
    }
  }
  return dt;                      /* 実距離は dt/3 */
}

/* ===== 本体 ===== */

/**
 * 符頭検出。
 * @param {ImageData} imageData  renderPageForOmr() が返すもの（staff.js に渡したのと同じ画像）
 * @param {Object} staffResult   detectStaves() の戻り値
 * @param {Object} [opts]
 *   headRadius … 塗りつぶし符頭とみなす内接円の半径（d 比）。連桁は 0.25d しかない
 *   headPeakR  … 頂上とみなす近傍の半径（d 比）。和音の最小間隔 d の半分より小さくすること
 *   holeMinW / holeMaxW / holeMinH / holeMaxH … 白玉の穴の大きさ（d 比）
 *   mergeX / mergeY     … 同じ符頭とみなす距離（d 比）。和音は縦 d/2 で並ぶので mergeY は小さく
 * @returns {{heads:Array, byStaff:Array, summary:Object}}
 *   heads[] = {staff, x, y, step, filled, w, h}
 *     x,y   … 実座標（傾き補正前）の中心
 *     step  … 第1線を0とした段数（上が正、1段 = d/2）
 *     filled… true=黒玉（4分以下）, false=白玉（2分・全音符）
 */
export function detectNoteheads(imageData, staffResult, opts = {}) {
  const {
    headRadius = 0.38,
    headPeakR = 0.45,
    headMinArea = 0.002,
    headMaxArea = 2.20,
    holeMinW = 0.22, holeMaxW = 1.15,
    holeMinH = 0.14, holeMaxH = 0.85,
    mergeX = 0.55, mergeY = 0.30,
  } = opts;

  const { bin, w, h } = binarize(imageData, opts);
  const heads = [];
  const byStaff = [];

  staffResult.staves.forEach((st, si) => {
    const d = st.d;
    const band = eraseStaffLines(cropStaffBand(bin, w, h, st), st, opts);
    const { ink, lw, lh, bx0, by0 } = band;
    const found = [];

    if (lw > 2 && lh > 2) {
      /* --- 黒玉：距離変換の【山の頂上】を1つの符頭とみなす --- */
      /* 単純にしきい値で切って連結成分にすると、3度堆積の和音のように符頭どうしが
         接している所（縦の間隔がちょうど d＝符頭の高さと同じ）で1つに繋がってしまい、
         4声の和音が中間の高さの1音に化ける。頂上を数えれば接していても分かれる。 */
      const need = d * headRadius * 3;              /* dt は3倍で持っている */
      const dt = distanceTransform(ink, lw, lh);
      const R = Math.max(1, Math.round(d * headPeakR));
      const core = new Uint8Array(lw * lh);
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x;
          if (dt[i] < need) continue;
          const v = dt[i];
          let top = 1;
          for (let yy = Math.max(0, y - R); yy <= Math.min(lh - 1, y + R) && top; yy++) {
            for (let xx = Math.max(0, x - R); xx <= Math.min(lw - 1, x + R); xx++) {
              if (dt[yy * lw + xx] > v) { top = 0; break; }
            }
          }
          if (top) core[i] = 1;                     /* 平らな頂上は連結成分でまとまる */
        }
      }
      /* 頂上は数画素しかない。ここを大きくすると全部落ちる */
      const minPix = Math.max(1, Math.round(d * d * headMinArea));
      const maxPix = Math.round(d * d * headMaxArea);
      for (const c of components(core, lw, lh, minPix)) {
        if (c.n > maxPix) continue;
        found.push({
          lx: c.sx / c.n, ly: c.sy / c.n, filled: true,
          w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1,
        });
      }

      /* --- 白玉：インクに囲まれた白い穴 --- */
      const holeMask = new Uint8Array(lw * lh);
      for (let i = 0; i < holeMask.length; i++) holeMask[i] = ink[i] ? 0 : 1;
      const holeMin = Math.max(3, Math.round(d * d * 0.04));
      for (const c of components(holeMask, lw, lh, holeMin)) {
        if (touchesEdge(c, lw, lh)) continue;         /* 外の余白と繋がっている＝穴ではない */
        const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
        if (cw < d * holeMinW || cw > d * holeMaxW) continue;
        if (ch < d * holeMinH || ch > d * holeMaxH) continue;
        found.push({ lx: c.sx / c.n, ly: c.sy / c.n, filled: false, w: cw, h: ch });
      }
    }

    /* --- 重なりを畳む。和音は縦に d/2 で並ぶので mergeY は d/2 未満にすること --- */
    found.sort((a, b) => a.lx - b.lx || a.ly - b.ly);
    const merged = [];
    for (const f of found) {
      const prev = merged.find(m =>
        Math.abs(m.lx - f.lx) < d * mergeX && Math.abs(m.ly - f.ly) < d * mergeY);
      if (prev) { if (f.filled) prev.filled = true; continue; }
      merged.push(f);
    }

    /* --- 実座標と段数へ --- */
    const list = merged.map(f => {
      const x = bx0 + f.lx;
      const y = by0 + f.ly;
      const yc = y - x * st.tan;                 /* 傾きを戻す */
      const step = Math.round((st.lines[4] - yc) / (d / 2));   /* 第1線=0、上が正 */
      return { staff: si, x, y, step, filled: f.filled, w: f.w, h: f.h };
    }).sort((a, b) => a.x - b.x || a.step - b.step);   /* 和音は下の音から並ぶ */

    byStaff.push(list);
    for (const n of list) heads.push(n);
  });

  const filled = heads.filter(n => n.filled).length;
  return {
    heads, byStaff,
    summary: {
      total: heads.length,
      filled,
      hollow: heads.length - filled,
      perStaff: byStaff.map(l => l.length),
      medWidth: median(heads.map(n => n.w)),
      medHeight: median(heads.map(n => n.h)),
    },
  };
}

/* ===== 検出結果の可視化（調整用。本番UIには不要） ===== */

/**
 * 符頭を canvas に重ねて描く。staff.js の drawOverlay() の後に呼ぶ想定。
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} result   detectNoteheads() の戻り値
 * @param {Object} staffResult detectStaves() の戻り値（d を引くため）
 * @param {number} [scale]
 */
export function drawNoteheadOverlay(ctx, result, staffResult, scale = 1) {
  const S = (v) => v * scale;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.font = '9px monospace';
  for (const n of result.heads) {
    const st = staffResult.staves[n.staff];
    const r = Math.max(2, S(st.d * 0.42));
    ctx.strokeStyle = n.filled ? 'rgba(255,190,40,0.95)' : 'rgba(80,200,255,0.95)';
    ctx.beginPath();
    ctx.arc(S(n.x), S(n.y), r, 0, Math.PI * 2);
    ctx.stroke();
    if (scale > 0.35) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(String(n.step), S(n.x) + r + 1, S(n.y) + 3);
    }
  }
  ctx.restore();
}
