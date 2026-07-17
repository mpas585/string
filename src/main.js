/*
  main.js — エントリポイント / 初期化順序
  ------------------------------------------------------------
  素の ES モジュール（ビルド無し）。import は必ず拡張子付き（'./state.js'）。
  CSS は index.html の <link> で読み込む（JSからのCSS importはバンドラ専用機能のため使わない）。

  移植が進むにつれ import と init() を順に有効化する。責務と移植元は README.md 参照。
  依存の向き（上が下に依存）:
    main → modes → { scale, songs, notation(動的), tuner(動的), pdf(動的) }
    modes → fingerboard → dom
    audio/* → audio/context
    すべて → state, dom, util（末端）
  遅延ロード境界（動的 import()／fetch）:
    notation.js / tuner.js / pdf.js … 各モードに入った時
    IR（audio/ir.js）/ 曲データ（songs） … 必要時に fetch
*/

// ---- core（移植済み） ----
import { ST } from './state.js';
import { on, toast } from './dom.js';
import * as U from './util.js';

// ---- 後続バッチで有効化 ----
// import { initAudio } from './audio/context.js';
// import { initFingerboard } from './fingerboard.js';
// import { initDrawer } from './drawer.js';
// import { initModes } from './modes.js';

function init() {
  // 各バッチの初期化呼び出しをここへ追加していく:
  //   initFingerboard(); initDrawer(); initModes();

  // core 動作確認の目印（移植完了後に削除）
  console.log('[cello] core loaded:', { mode: ST.mode, open: U.OPEN, c4: U.midiName(60) });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
