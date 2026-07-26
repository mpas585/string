/*
  omr-import.js — 表示しているPDFの譜面を読み取って、アプリの譜面データにする。

  流れ:
    renderPageForOmr（検出用の解像度で描画）
      → detectStaves（五線）
      → detectNoteheads（符頭）
      → assignPitches（音部記号・調号から音高）
      → ここで events に変換して setScore

  【この読み取りで分かること・分からないこと】
    分かる : 音の高さ、左から右への並び、和音（縦に重なった符頭）
    分からない: 音価（符頭の白黒しか見ていない。旗・連桁・付点・休符は読んでいない）、
                小節線、拍子、繰り返し記号、タイ、スラー
    したがって【リズムは推定】であり、白玉=2拍・黒玉=1拍として並べているだけ。
    音程の練習には使えるが、そのまま曲として再生できるものではない。

  対象は「今表示しているページ」だけ。複数ページの曲はページごとに取り込む。
*/
import { renderPageForOmr, pdfPage } from './pdf.js';
import { detectStaves } from './omr/staff.js';
import { detectNoteheads } from './omr/notehead.js';
import { assignPitches } from './omr/pitch.js';
import { closePdfOverlay } from './drawer.js';
import { setScore } from './modes.js';
import { recommend } from './fingerboard.js';
import { midiName, tt } from './util.js';
import { toast } from './dom.js';

const BEATS_PER_MEASURE = 4;   /* 拍子は読めないので4/4と仮定して小節を切る */
const DUR_FILLED = 1;          /* 黒玉＝4分音符とみなす */
const DUR_HOLLOW = 2;          /* 白玉＝2分音符とみなす */

let busy = false;

/* 重い同期処理の前に1フレーム返して、トーストや表示を描かせる */
const yieldUI = () => new Promise(r => setTimeout(r, 16));

/* 符頭を「段 → 左から右」に並べ、縦に重なっているものを和音としてまとめる */
export function groupHeads(pitchResult, staffResult) {
  const heads = pitchResult.heads.slice().sort((a, b) => (a.staff - b.staff) || (a.x - b.x));
  const groups = [];
  for (const n of heads) {
    const d = staffResult.staves[n.staff].d;      /* 五線の線間隔＝大きさの基準 */
    const g = groups[groups.length - 1];
    /* 同じ段で x がほぼ同じ＝同時に鳴る音（和音・重音） */
    if (g && g.staff === n.staff && Math.abs(n.x - g.x) <= d * 0.8) {
      g.notes.push(n);
      g.x = g.notes.reduce((s, m) => s + m.x, 0) / g.notes.length;
    } else {
      groups.push({ staff: n.staff, x: n.x, notes: [n] });
    }
  }
  return groups;
}

/* まとめた符頭を、アプリの譜面データ（parseMusicXML と同じ形）に変換する */
export function toScore(groups) {
  let onset = 0;
  const events = groups.map((g, i) => {
    /* 全部が白玉のときだけ2拍。黒玉が混ざれば1拍。旗も連桁も読めないのでここまで */
    const dur = g.notes.every(n => !n.filled) ? DUR_HOLLOW : DUR_FILLED;
    const midis = [...new Set(g.notes.map(n => n.midi))].sort((a, b) => a - b);
    const pitches = midis.map(m => ({ midi: m, name: midiName(m) }));
    const ev = {
      id: i,
      measure: Math.floor(onset / BEATS_PER_MEASURE) + 1,
      onset, dur,
      pitches,
      leadIdx: pitches.length - 1,     /* 旋律は上の音。parseMusicXML と揃えている */
      fing: null,
    };
    onset += dur;
    return ev;
  });
  events.forEach(e => { e.fing = recommend(e.pitches[e.leadIdx].midi); });

  const measures = [];
  const maxM = Math.max(1, Math.ceil(onset / BEATS_PER_MEASURE));
  for (let m = 1; m <= maxM; m++) measures.push({ num: m, start: (m - 1) * BEATS_PER_MEASURE, end: m * BEATS_PER_MEASURE });

  return { events, measures, beatsPerMeasure: BEATS_PER_MEASURE, beatUnit: 1 };
}

/* 画面の「取り込む」から呼ぶ本体 */
export async function importPdfScore() {
  if (busy) return;
  const btn = document.getElementById('pdfImport');
  busy = true;
  if (btn) btn.disabled = true;

  try {
    toast(tt('msg.omr_run'));
    await yieldUI();

    const page = await renderPageForOmr(pdfPage);
    await yieldUI();

    const staff = detectStaves(page.imageData);
    if (!staff.staves.length) { toast(tt('msg.omr_nostaff')); return; }
    await yieldUI();

    const heads = detectNoteheads(page.imageData, staff);
    if (!heads.heads.length) { toast(tt('msg.omr_nonote')); return; }
    await yieldUI();

    const pitched = assignPitches(page.imageData, staff, heads);
    const groups = groupHeads(pitched, staff);
    if (!groups.length) { toast(tt('msg.omr_nonote')); return; }

    const parsed = toScore(groups);
    setScore(parsed, 'omr:p' + pdfPage);
    closePdfOverlay();

    /* 判定が怪しい段があれば黙って通さず、そのまま伝える */
    const low = pitched.summary.lowConfidence || [];
    const note = low.length ? tt('msg.omr_lowconf', low.length) : '';
    toast(tt('msg.omr_done', parsed.events.length, staff.staves.length) + note);
    console.info('[GEN strings OMR]', {
      page: pdfPage, dpi: Math.round(page.dpi),
      staves: staff.staves.length, clefs: pitched.summary.clefs, keys: pitched.summary.keys,
      heads: pitched.heads.length, dropped: pitched.summary.dropped,
      events: parsed.events.length, range: pitched.summary.range,
    });
  } catch (err) {
    toast(tt('msg.omr_fail', err.message));
    console.error(err);
  } finally {
    busy = false;
    if (btn) btn.disabled = false;
  }
}
