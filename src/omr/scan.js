/*
  omr/scan.js — アプリ本体と OMR をつなぐ層。

  PDFオーバーレイの「このページを読み取る」から呼ばれ、
    表示中のページを検出解像度で描き直す
      → 五線 → 符頭 → 音高 → 小節線 → 臨時記号 → 音価 → 休符
      → 曲JSON（public/songs/*.json と同じ形）
      → songs.js の buildSongFromData に渡して指板に載せる
  までを一続きで行う。

  ■ 重い処理なので
    実スキャン（4964×3510）で3〜5秒かかる。ブラウザは処理中は固まるので、
    段ごとに画面へ進み具合を出し、次の段へ移る前に1フレーム譲る。
    そうしないと「押しても何も起きない」ように見える。

  ■ 読み取りは必ず外れる
    版によって記号の形も寸法も違う。だから warnings を toast で出し、
    詳しくは console に出す。黙って間違ったデータを載せない。
*/

import { ST } from '../state.js';
import { toast } from '../dom.js';
import { tt } from '../util.js';
import { renderPageForOmr, pdfDoc, pdfPage } from '../pdf.js';
import { binarize } from './staff.js';
import { detectStaves } from './staff.js';
import { detectNoteheads } from './notehead.js';
import { assignPitches } from './pitch.js';
import { detectMeasures } from './barline.js';
import { detectDurations } from './duration.js';
import { detectRests } from './rest.js';
import { toSong } from './tosong.js';

/** 直近の読み取り結果。console から中身を見たい時のため（window.__omr に入れる） */
export let lastScan = null;

/* 画面を描かせるために1フレーム譲る */
const yieldFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * 表示中のPDFページを読み取って曲データにする。
 * 画面には載せない（結果を返すだけ）ので、確認用にも使える。
 *
 * @param {Object} [opts]
 *   page … ページ番号。省略時は表示中のページ
 *   onStep … (текст) => void 進み具合の通知
 *   その他は各段の opts にそのまま渡る
 * @returns {{song:Object, warnings:Array, stats:Object, detail:Object}}
 */
export async function scanPage(opts = {}) {
  if (!pdfDoc) throw new Error(tt('msg.pdf_not_open'));
  const step = opts.onStep || (() => {});
  const no = opts.page || pdfPage;

  step(tt('msg.omr_rendering'));
  await yieldFrame();
  const page = await renderPageForOmr(no, opts);
  const { imageData } = page;

  step(tt('msg.omr_staff'));
  await yieldFrame();
  const staves = detectStaves(imageData, opts);
  if (!staves.staves.length) throw new Error(tt('msg.omr_no_staff'));

  step(tt('msg.omr_heads'));
  await yieldFrame();
  const heads = detectNoteheads(imageData, staves, opts);
  if (!heads.heads.length) throw new Error(tt('msg.omr_no_heads'));

  step(tt('msg.omr_clef'));
  await yieldFrame();
  const bz = binarize(imageData, opts);
  const pre = assignPitches(imageData, staves, heads, opts);

  step(tt('msg.omr_bars'));
  await yieldFrame();
  const measures = detectMeasures(bz.bin, bz.w, bz.h, staves, heads,
    { ...opts, startX: pre.summary.startX });

  step(tt('msg.omr_pitch'));
  await yieldFrame();
  const pitch = assignPitches(imageData, staves, heads, { ...opts, measures });

  step(tt('msg.omr_dur'));
  await yieldFrame();
  const durations = detectDurations(bz.bin, bz.w, bz.h, staves, heads, opts);

  step(tt('msg.omr_rest'));
  await yieldFrame();
  const rests = detectRests(bz.bin, bz.w, bz.h, staves, heads,
    { ...opts, startX: pre.summary.startX });

  const out = toSong({ pitch, durations, rests, measures }, {
    id: `scan-p${no}`,
    tempo: Math.round(ST.tempo) || 80,
    ...opts,
  });

  lastScan = { ...out, detail: { page, staves, heads, pitch, measures, durations, rests } };
  if (typeof window !== 'undefined') window.__omr = lastScan;
  return lastScan;
}

/**
 * 読み取って、そのまま指板に載せる。
 * 読み込み経路は他（曲・MusicXML）と同じ手順を踏む。
 *
 * setTempo → setScore の順は変えないこと。setScore が「譜面本来のテンポ」を
 * そこで控えるので、逆にするとテンポのリセット先がずれる。
 *
 * @param {Function} apply  (song) => void 実際に載せる処理。呼び出し側から渡す
 *                          （songs.js を import すると循環参照になるため）
 */
export async function scanAndLoad(apply, opts = {}) {
  const busy = document.getElementById('omrBusy');
  const label = document.getElementById('omrBusyText');
  const show = (msg) => { if (label) label.textContent = msg; };
  if (busy) busy.classList.add('open');
  try {
    const res = await scanPage({ ...opts, onStep: show });
    show(tt('msg.omr_applying'));
    await yieldFrame();
    apply(res.song);

    /* 読み取りは外れることがある。気になる点は必ず知らせる */
    if (res.warnings.length) {
      console.warn('[GEN strings] OMR:', res.warnings.join('\n'));
      toast(tt('msg.omr_done_warn', res.stats.notes, res.warnings.length));
    } else {
      toast(tt('msg.omr_done', res.stats.notes, res.stats.rests));
    }
    return res;
  } catch (err) {
    console.error('[GEN strings] OMR:', err);
    toast(tt('msg.omr_failed', err.message));
    throw err;
  } finally {
    if (busy) busy.classList.remove('open');
  }
}
