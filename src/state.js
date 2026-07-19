/*
  state.js — アプリ全体の状態 ST と音量プロファイル。
  元 cello-finger.html より無改変で移植。
    DEFAULT_VOL/VOL_KEYS/volProfileKey … L952–960
    ST                                 … L962–1022
  volProfileKey は ST.mode を参照（同一モジュール内なので依存解決は不要）。
*/

/* 音量の初期値（モード別）。全トラック +5（0〜100表示）で底上げ済み。
   scale の metro は既に上限 100 のためそのまま。 */
export const DEFAULT_VOL = {
  /* スケール練習：ガイドメロは小さく、メトロノームが一番大きい */
  scale: {master:0.80, lead:0.35, drum:0.60, bass:0.60, chord:0.50, metro:1.00},
  /* 曲を練習：メロディ主体 */
  score: {master:0.80, lead:0.90, drum:0.65, bass:0.65, chord:0.60, metro:0.55}
};
export const VOL_KEYS=['master','lead','drum','bass','chord','metro'];
export function volProfileKey(){ return (ST.mode==='scale') ? 'scale' : 'score'; }

/* ===== 状態 ===== */
export const ST = {
  mode: null,            // null | 'scale' | 'score'
  events: [],
  measures: [],          // [{num, start, end}] 単位=4分音符
  beatsPerMeasure: 4,
  tempo: 80,
  pref: 'low',
  selected: null,
  current: null,
  playing: false,
  timers: [],
  ctx: null,
  master: null,
  noise: null,
  range: null,
  beatSec: 0.75,
  passDur: 0,
  t0: 0,
  /* 練習モード */
  loop: {on:false, from:1, to:4},
  enjoy: false,
  keyRoot: 0,
  scaleType: 'pop',
  scaleOct: 2,
  /* チューナーモード */
  tunerMidi: null,
  tunerCents: 0,
  /* 再生メーター */
  seekRaf: 0,
  playhead: 0,          // 次に ▶ を押したときの開始拍
  /* 指板ズーム */
  zoom: 1,
  /* 弦の振動 */
  vib: [null,null,null,null],
  vibRaf: 0,
  /* 表示 */
  view: 'board',        // 'board' | 'staff'
  lang: 'ja',           // 表示言語（切替UIのみ。文言の差し替えは未実装）
  frets: true,
  landscape: false,     // 横画面固定
  landAuto: false,      // 五線譜が自動でONにしたか
  /* オクターブ */
  octave: 'auto',       // 'auto' | 0 | -1 | 1
  octShift: 0,          // 実際に適用中のシフト
  parsed: null,         // 元データ（移調前）
  /* 音量 */
  volProfiles: {scale:Object.assign({},DEFAULT_VOL.scale), score:Object.assign({},DEFAULT_VOL.score)},
  vol: Object.assign({}, DEFAULT_VOL.score),
  /* 4カウント・スリープ防止 */
  countIn: true,
  keepAwake: true,
  wakeLock: null,
  buses: null,
  /* ストリップの手動スワイプ時刻 */
  stripHold: 0,
  /* 譜面ID（運指保存用） */
  scoreName: '',
  /* 表示 */
  lastScrollId: null,
  holding: false,
};
