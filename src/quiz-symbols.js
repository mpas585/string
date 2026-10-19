/*
  quiz-symbols.js — 楽譜クイズの五線譜を描く（src/quiz.js から使う）。

  ・音符問題 … staffNoteSvg(clef, step, acc)
      step は「第1線（いちばん下の線）＝0」から数えた段数（線と間で1段ずつ）。
      acc は 1=♯ / -1=♭ / 0=なし。
  ・記号問題 … symbolSvg(id, clef)
      id は SYMBOLS の id。文言（名前・意味）は includes/lang/*.php の quiz.sym にある。

  記号はできるだけ線と塗りで描く。音楽記号のフォント（U+1D100〜）は端末によって
  入っていないことがあり、♯・休符などが豆腐になると問題として成り立たないため。
  音部記号だけは五線譜表示（src/notation.js の CLEFS）と同じ文字を使う
  （形が複雑で、線で描くと別物に見えるため）。
*/
import { CLEFS } from './notation.js';

/* 記号の一覧。group は4択の「はずれ」を同じ仲間から選ぶためのまとまり
   （強弱の問題に速度の答えが混ざると、見ただけで外せてしまうため）。
     dyn   … 強弱
     tempo … 速さ
     art   … 奏法・アーティキュレーション
     sign  … 臨時記号・反復・終止
     val   … 音符・休符の種類（問いの文が「この音符・休符はどれ？」になる） */
export const SYMBOLS = [
  {id:'pp', group:'dyn'}, {id:'p', group:'dyn'}, {id:'mp', group:'dyn'}, {id:'mf', group:'dyn'},
  {id:'f', group:'dyn'}, {id:'ff', group:'dyn'}, {id:'sfz', group:'dyn'}, {id:'fp', group:'dyn'},
  {id:'cresc', group:'dyn'}, {id:'dim', group:'dyn'},
  {id:'rit', group:'tempo'}, {id:'accel', group:'tempo'}, {id:'atempo', group:'tempo'},
  {id:'allegro', group:'tempo'}, {id:'andante', group:'tempo'}, {id:'adagio', group:'tempo'},
  {id:'moderato', group:'tempo'}, {id:'presto', group:'tempo'},
  {id:'stacc', group:'art'}, {id:'accent', group:'art'}, {id:'tenuto', group:'art'}, {id:'fermata', group:'art'},
  {id:'slur', group:'art'}, {id:'tie', group:'art'}, {id:'pizz', group:'art'}, {id:'arco', group:'art'},
  {id:'down', group:'art'}, {id:'up', group:'art'},
  {id:'sharp', group:'sign'}, {id:'flat', group:'sign'}, {id:'natural', group:'sign'}, {id:'repeat', group:'sign'},
  {id:'dc', group:'sign'}, {id:'ds', group:'sign'}, {id:'fine', group:'sign'}, {id:'coda', group:'sign'},
  {id:'n1', group:'val'}, {id:'n2', group:'val'}, {id:'n2d', group:'val'}, {id:'n4', group:'val'},
  {id:'n8', group:'val'}, {id:'n16', group:'val'},
  {id:'r1', group:'val'}, {id:'r2', group:'val'}, {id:'r4', group:'val'}, {id:'r8', group:'val'},
];

/* ===== 五線の寸法（viewBox 単位）===== */
const W = 300, H = 170;
const TOP = 54, SP = 12;                 /* 第5線の y と線の間隔 */
const BOT = TOP + 4 * SP;                /* 第1線の y（=102） */
const INK = 'var(--ink)';
const SERIF = `font-family="'Times New Roman',Georgia,'Noto Serif',serif"`;

/* 段 → y（段0＝第1線、段8＝第5線） */
export function stepY(k){ return BOT - k * (SP / 2); }

function ln(x1, y1, x2, y2, w, col){
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col || INK}" stroke-width="${w || 1.6}" stroke-linecap="round"/>`;
}
function staffLines(x0, x1){
  const p = [];
  for (let i = 0; i < 5; i++){
    const y = TOP + i * SP;
    p.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="var(--muted)" stroke-width="1.2" opacity="0.7"/>`);
  }
  return p.join('');
}
/* 音部記号。字形は src/notation.js の CLEFS と同じ。そちらは線間 9 で決めた値なので、ここ（線間 12）へ拡大する */
function clefGlyph(clef){
  const c = CLEFS[clef] || CLEFS.treble;
  const k = SP / 9;
  const size = (c.size * k).toFixed(1), y = (BOT + c.dy * k).toFixed(1);
  return `<text x="12" y="${y}" font-size="${size}" fill="${INK}" ` +
         `font-family="'Noto Music','Bravura','Segoe UI Symbol','Apple Symbols',serif">${c.glyph}</text>`;
}
function svgWrap(clef, body, x1){
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">` +
         staffLines(8, x1 || W - 8) + clefGlyph(clef) + body + '</svg>';
}

/* 加線（第1線より下・第5線より上の音） */
function ledgers(x, k){
  const p = [];
  for (let s = -2; s >= k; s -= 2) p.push(ln(x - 15, stepY(s), x + 15, stepY(s), 1.5, 'var(--muted)'));
  for (let s = 10; s <= k; s += 2) p.push(ln(x - 15, stepY(s), x + 15, stepY(s), 1.5, 'var(--muted)'));
  return p.join('');
}

/* 符頭。hollow＝白玉（2分・全音符） */
function head(x, k, hollow, whole){
  const y = stepY(k);
  if (whole){
    return `<ellipse cx="${x}" cy="${y}" rx="8.6" ry="5.6" fill="none" stroke="${INK}" stroke-width="2.6"/>`;
  }
  if (hollow){
    return `<ellipse cx="${x}" cy="${y}" rx="7.2" ry="5.0" fill="none" stroke="${INK}" stroke-width="2.1" transform="rotate(-20 ${x} ${y})"/>`;
  }
  return `<ellipse cx="${x}" cy="${y}" rx="7.2" ry="5.2" fill="${INK}" transform="rotate(-20 ${x} ${y})"/>`;
}

/* 音符1つ。type: w=全 h=2分 q=4分 e=8分 s=16分。dot=付点。
   符幹は第3線より下なら上向き（右側）、それ以上なら下向き（左側）。 */
function note(x, k, type, dot){
  const p = [ledgers(x, k)];
  const y = stepY(k);
  p.push(head(x, k, type === 'h' || type === 'w', type === 'w'));
  if (type !== 'w'){
    const up = k < 4;
    const sx = up ? x + 6.6 : x - 6.6;
    const sy = up ? y - 1 : y + 1, ey = up ? y - 38 : y + 38;
    p.push(ln(sx, sy, sx, ey, 1.7));
    const flags = (type === 'e') ? 1 : (type === 's') ? 2 : 0;
    for (let i = 0; i < flags; i++){
      const fy = up ? ey + i * 8 : ey - i * 8;
      p.push(up
        ? `<path d="M ${sx} ${fy} c 1 9 13 11 10 25" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`
        : `<path d="M ${sx} ${fy} c 1 -9 13 -11 10 -25" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`);
    }
  }
  if (dot){
    const dy = (k % 2 === 0) ? -SP / 2 * 0.6 : 0;   /* 線の上の音は付点を間へずらす */
    p.push(`<circle cx="${x + 14}" cy="${(y + dy).toFixed(1)}" r="2.6" fill="${INK}"/>`);
  }
  return p.join('');
}

/* 臨時記号（線で描く）。x は符頭の中心、k は段 */
export function accidental(x, k, acc){
  const y = stepY(k), ax = x - 22;
  if (acc === 1){
    return ln(ax - 3, y - 15, ax - 3, y + 15, 1.6) + ln(ax + 3, y - 17, ax + 3, y + 13, 1.6) +
           ln(ax - 8, y - 3, ax + 8, y - 7, 3.4) + ln(ax - 8, y + 7, ax + 8, y + 3, 3.4);
  }
  if (acc === -1){
    return ln(ax - 3, y - 24, ax - 3, y + 6, 1.7) +
           `<path d="M ${ax - 3} ${y + 6} C ${ax + 10} ${y - 2} ${ax + 8} ${y - 12} ${ax - 3} ${y - 3}" fill="none" stroke="${INK}" stroke-width="2.6"/>`;
  }
  if (acc === 2){                                     /* ナチュラル（記号問題だけで使う） */
    return ln(ax - 4, y - 16, ax - 4, y + 7, 1.6) + ln(ax + 4, y - 7, ax + 4, y + 16, 1.6) +
           ln(ax - 4, y - 4, ax + 4, y - 7, 3.2) + ln(ax - 4, y + 7, ax + 4, y + 4, 3.2);
  }
  return '';
}

/* 休符。x は中心 */
function rest(x, type){
  const mid = stepY(4);
  if (type === 'w') return `<rect x="${x - 9}" y="${stepY(6)}" width="18" height="6" fill="${INK}"/>`;
  if (type === 'h') return `<rect x="${x - 9}" y="${stepY(4) - 6}" width="18" height="6" fill="${INK}"/>`;
  if (type === 'q'){
    return `<path d="M ${x - 3} ${mid - 20} L ${x + 5} ${mid - 10} C ${x - 3} ${mid - 5} ${x - 3} ${mid - 1} ${x + 5} ${mid + 6} ` +
           `C ${x - 5} ${mid + 2} ${x - 8} ${mid + 10} ${x + 1} ${mid + 17}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  /* 8分休符 */
  return `<circle cx="${x - 4}" cy="${mid - 6}" r="3.4" fill="${INK}"/>` +
         `<path d="M ${x - 6} ${mid - 4} Q ${x + 1} ${mid - 1} ${x + 6} ${mid - 9} L ${x - 1} ${mid + 14}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/* 文字の記号 */
function dynText(x, s){
  return `<text x="${x}" y="${BOT + 34}" font-size="28" font-weight="700" font-style="italic" text-anchor="middle" fill="${INK}" ${SERIF}>${s}</text>`;
}
function topText(x, s, italic, anchor){
  return `<text x="${x}" y="${TOP - 18}" font-size="${italic ? 22 : 21}" font-weight="700" ${italic ? 'font-style="italic"' : ''} ` +
         `text-anchor="${anchor || 'middle'}" fill="${INK}" ${SERIF}>${s}</text>`;
}
function endBar(x){ return ln(x, TOP, x, BOT, 1.6) + `<rect x="${x + 4}" y="${TOP}" width="5" height="${BOT - TOP}" fill="${INK}"/>`; }

/* 1小節ぶんの「ふつうの音符」（文字記号の問題で、記号が何にかかるかを見せる） */
function phrase(){
  return note(120, 2, 'q') + note(170, 3, 'q') + note(220, 4, 'q') + note(266, 2, 'q');
}

/* ===== 記号問題の絵 ===== */
export function symbolSvg(id, clef){
  const cx = 180;
  switch (id){
    case 'pp': case 'p': case 'mp': case 'mf': case 'f': case 'ff': case 'sfz': case 'fp':
      return svgWrap(clef, note(cx, 3, 'q') + dynText(cx, id));
    case 'cresc': case 'dim': {
      const y = BOT + 26, x0 = 110, x1 = 260;
      const hp = (id === 'cresc')
        ? ln(x0, y, x1, y - 8, 1.8) + ln(x0, y, x1, y + 8, 1.8)
        : ln(x0, y - 8, x1, y, 1.8) + ln(x0, y + 8, x1, y, 1.8);
      return svgWrap(clef, note(120, 2, 'q') + note(170, 3, 'q') + note(220, 4, 'q') + note(260, 5, 'q') + hp);
    }
    case 'rit':     return svgWrap(clef, phrase() + topText(110, 'rit.', true, 'start'));
    case 'accel':   return svgWrap(clef, phrase() + topText(110, 'accel.', true, 'start'));
    case 'atempo':  return svgWrap(clef, phrase() + topText(110, 'a tempo', true, 'start'));
    case 'allegro': return svgWrap(clef, phrase() + topText(80, 'Allegro', false, 'start'));
    case 'andante': return svgWrap(clef, phrase() + topText(80, 'Andante', false, 'start'));
    case 'adagio':  return svgWrap(clef, phrase() + topText(80, 'Adagio', false, 'start'));
    case 'moderato':return svgWrap(clef, phrase() + topText(80, 'Moderato', false, 'start'));
    case 'presto':  return svgWrap(clef, phrase() + topText(80, 'Presto', false, 'start'));
    case 'stacc':   return svgWrap(clef, note(cx, 2, 'q') + `<circle cx="${cx}" cy="${stepY(2) + 12}" r="2.8" fill="${INK}"/>`);
    case 'accent': {
      const y = stepY(2) + 12;
      return svgWrap(clef, note(cx, 2, 'q') +
        `<path d="M ${cx - 8} ${y - 4} L ${cx + 8} ${y + 1} L ${cx - 8} ${y + 6}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`);
    }
    case 'tenuto':  return svgWrap(clef, note(cx, 2, 'q') + ln(cx - 8, stepY(2) + 12, cx + 8, stepY(2) + 12, 2.6));
    case 'fermata': {
      const y = TOP - 16;
      return svgWrap(clef, note(cx, 3, 'q') +
        `<path d="M ${cx - 14} ${y + 2} A 14 13 0 0 1 ${cx + 14} ${y + 2}" fill="none" stroke="${INK}" stroke-width="2.6"/>` +
        `<circle cx="${cx}" cy="${y - 1}" r="2.8" fill="${INK}"/>`);
    }
    case 'slur': {
      const y1 = stepY(1), y2 = stepY(3);
      return svgWrap(clef, note(130, 1, 'q') + note(230, 3, 'q') +
        `<path d="M ${130} ${y1 + 10} Q ${180} ${Math.max(y1, y2) + 30} ${230} ${y2 + 10}" fill="none" stroke="${INK}" stroke-width="2.2"/>`);
    }
    case 'tie': {
      const y = stepY(2);
      return svgWrap(clef, note(140, 2, 'q') + note(220, 2, 'q') +
        `<path d="M ${146} ${y + 9} Q ${180} ${y + 22} ${214} ${y + 9}" fill="none" stroke="${INK}" stroke-width="2.2"/>`);
    }
    case 'pizz':  return svgWrap(clef, phrase() + topText(110, 'pizz.', true, 'start'));
    case 'arco':  return svgWrap(clef, phrase() + topText(110, 'arco', true, 'start'));
    case 'down': {
      const y = TOP - 14;
      return svgWrap(clef, note(cx, 3, 'q') +
        `<rect x="${cx - 10}" y="${y - 14}" width="20" height="4.5" fill="${INK}"/>` +
        ln(cx - 9, y - 12, cx - 9, y + 2, 2) + ln(cx + 9, y - 12, cx + 9, y + 2, 2));
    }
    case 'up': {
      const y = TOP - 14;
      return svgWrap(clef, note(cx, 3, 'q') +
        `<path d="M ${cx - 8} ${y - 14} L ${cx} ${y + 4} L ${cx + 8} ${y - 14}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`);
    }
    case 'sharp':   return svgWrap(clef, accidental(cx, 3, 1) + note(cx, 3, 'q'));
    case 'flat':    return svgWrap(clef, accidental(cx, 3, -1) + note(cx, 3, 'q'));
    case 'natural': return svgWrap(clef, accidental(cx, 3, 2) + note(cx, 3, 'q'));
    case 'repeat': {
      const x = 252;
      return svgWrap(clef, note(120, 2, 'q') + note(170, 3, 'q') + note(220, 4, 'q') +
        `<circle cx="${x - 9}" cy="${stepY(5)}" r="3" fill="${INK}"/><circle cx="${x - 9}" cy="${stepY(3)}" r="3" fill="${INK}"/>` +
        endBar(x), x + 9);
    }
    case 'dc': case 'ds': case 'fine': {
      const label = (id === 'dc') ? 'D.C.' : (id === 'ds') ? 'D.S.' : 'Fine';
      const x = 262;
      return svgWrap(clef, note(120, 2, 'q') + note(170, 3, 'q') + note(220, 4, 'q') +
        ((id === 'fine') ? endBar(x - 9) : ln(x, TOP, x, BOT, 1.6)) +
        `<text x="${x}" y="${BOT + 32}" font-size="22" font-weight="700" font-style="italic" text-anchor="end" fill="${INK}" ${SERIF}>${label}</text>`,
        x);
    }
    case 'coda': {
      const y = TOP - 22;
      return svgWrap(clef, phrase() +
        `<ellipse cx="${cx}" cy="${y}" rx="9" ry="11" fill="none" stroke="${INK}" stroke-width="2.6"/>` +
        ln(cx, y - 17, cx, y + 17, 1.8) + ln(cx - 15, y, cx + 15, y, 1.8));
    }
    case 'n1':  return svgWrap(clef, note(cx, 3, 'w'));
    case 'n2':  return svgWrap(clef, note(cx, 3, 'h'));
    case 'n2d': return svgWrap(clef, note(cx, 3, 'h', true));
    case 'n4':  return svgWrap(clef, note(cx, 3, 'q'));
    case 'n8':  return svgWrap(clef, note(cx, 3, 'e'));
    case 'n16': return svgWrap(clef, note(cx, 3, 's'));
    case 'r1':  return svgWrap(clef, rest(cx, 'w'));
    case 'r2':  return svgWrap(clef, rest(cx, 'h'));
    case 'r4':  return svgWrap(clef, rest(cx, 'q'));
    case 'r8':  return svgWrap(clef, rest(cx, 'e'));
  }
  return svgWrap(clef, '');
}

/* ===== 音符問題の絵 ===== */
export function staffNoteSvg(clef, step, acc){
  const cx = 180;
  return svgWrap(clef, accidental(cx, step, acc) + note(cx, step, 'q'));
}
