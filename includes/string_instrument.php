<?php
/*
  string_instrument.php — 基幹。/{言語}/{楽器}/index.php から呼ばれる唯一の入口。

  呼び出し側で $LANG と $INSTRUMENT を定義しておくこと:
      $LANG = 'ja'; $INSTRUMENT = 'cello';
      require __DIR__ . '/../../includes/string_instrument.php';

  ここでやること:
    1. 言語・辞書・ヘルパ・パスは includes/bootstrap.php（トップ /{言語}/ と共通）
    2. 楽器のホワイトリスト検証と config/{楽器}.php の読み込み
    3. 楽器定義を window.INSTRUMENT / 言語を window.APP として JS へ受け渡し
    4. ビュー（includes/views/*.php）の呼び出し。HTML はそちらにあり、このファイルには無い。
       JS 本体（src/）と静的データ（public/）はルート直下のまま。
       参照は ../../ 固定（サブディレクトリ設置でもそのまま動く）
*/

/* STRING_APP はルートの index.php が先に定義している場合がある */
if (!defined('STRING_APP')) { define('STRING_APP', 1); }
define('APP_ROOT', dirname(__DIR__));

/* このファイルを直接 URL で叩かれた場合は拒否する（$LANG/$INSTRUMENT が無いまま
   既定のページを二重に配信してしまうため。相対パスも崩れる） */
if (realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'] ?? '')) { http_response_code(403); exit; }

/* 言語・辞書・ヘルパ（h/t/e/er）・パス（$BASE/$rootPath/$origin）は共通処理へ。
   対応言語・対応楽器の定義は config/app.php が唯一の出所（bootstrap が読む）。 */
$URL_DEPTH = 2;                                         /* 公開URLは /{言語}/{楽器}/ の2階層 */
require __DIR__ . '/bootstrap.php';

/* ===== 1. 検証（ホワイトリスト外は既定値。require のパスに直接使うため必須） ===== */
$INSTRUMENT = (isset($INSTRUMENT) && in_array($INSTRUMENT, APP_INSTRUMENTS, true)) ? $INSTRUMENT : APP_DEFAULT_INSTRUMENT;

/* ===== 2. 読み込み ===== */
require APP_ROOT . '/includes/midi.php';
require APP_ROOT . '/includes/fingering.php';
$INST = require APP_ROOT . '/config/' . $INSTRUMENT . '.php';

/* ===== 3. 表示値 ===== */
$INST_NAME   = t('instrument.' . $INSTRUMENT);          /* 言語別の楽器名 */
$NOTE_NAMES  = midi_note_names($T);
$OPEN_LABELS = midi_open_labels($INST, $NOTE_NAMES);

/* 言語切替のリンク先（同じ楽器の各言語版。パス絶対） */
$LANG_URLS = [];
foreach (APP_LANGS as $l) { $LANG_URLS[$l] = $rootPath . '/' . $l . '/' . $INSTRUMENT . '/'; }

/* JS へ渡す値 */
$JS_APP = [
  'lang'       => $LANG,
  'htmlLang'   => $T['html_lang'],
  'instrument' => $INSTRUMENT,
  'base'       => $BASE,
  'langUrls'   => $LANG_URLS,
  'noteNames'  => $NOTE_NAMES,
];
$JS_INSTRUMENT = fingering_js_config($INST, $T);
$JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;
/* ===== 5. ビューの振り分け =====
   ここから下に HTML は書かない。画面を直すときは includes/views/ を触る。
   ビューからは上で作った変数（$T/$INST/$INST_NAME/$BASE/$LANG_URLS 等）と
   t()/h()/e()/er() がそのまま使える。 */
header('Content-Type: text/html; charset=UTF-8');

if (empty($INST['ready'])) {
  /* 準備中の楽器。戻り先は既定楽器（config/app.php）から組み立てる */
  $DEF      = require APP_ROOT . '/config/' . APP_DEFAULT_INSTRUMENT . '.php';
  $DEF_NAME = t('instrument.' . APP_DEFAULT_INSTRUMENT);
  $DEF_URL  = $rootPath . '/' . $LANG . '/' . APP_DEFAULT_INSTRUMENT . '/';
  require APP_ROOT . '/includes/views/soon.php';
  return;
}
require APP_ROOT . '/includes/views/app.php';
