<?php
/*
  string_instrument.php — 基幹。/{言語}/{楽器}/index.php から呼ばれる唯一の入口。

  呼び出し側で $LANG と $INSTRUMENT を定義しておくこと:
      $LANG = 'ja'; $INSTRUMENT = 'cello';
      require __DIR__ . '/../../includes/string_instrument.php';

  ここでやること:
    1. 言語・楽器のホワイトリスト検証
    2. config/{楽器}.php と includes/lang/{言語}.php の読み込み
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

/* 対応言語・対応楽器は config/app.php が唯一の定義。増やすときはそこだけ直す */
$APP_CFG = require APP_ROOT . '/config/app.php';
define('APP_NAME',               $APP_CFG['name']);
define('APP_LANGS',              $APP_CFG['langs']);
define('APP_INSTRUMENTS',        $APP_CFG['instruments']);
define('APP_DEFAULT_LANG',       $APP_CFG['default_lang']);
define('APP_DEFAULT_INSTRUMENT', $APP_CFG['default_instrument']);

/* ===== 1. 検証（ホワイトリスト外は既定値。require のパスに直接使うため必須） ===== */
$LANG       = (isset($LANG)       && in_array($LANG, APP_LANGS, true))             ? $LANG       : APP_DEFAULT_LANG;
$INSTRUMENT = (isset($INSTRUMENT) && in_array($INSTRUMENT, APP_INSTRUMENTS, true)) ? $INSTRUMENT : APP_DEFAULT_INSTRUMENT;

/* ===== 2. 読み込み ===== */
require APP_ROOT . '/includes/midi.php';
require APP_ROOT . '/includes/fingering.php';
$INST = require APP_ROOT . '/config/' . $INSTRUMENT . '.php';
$T    = require APP_ROOT . '/includes/lang/' . $LANG . '.php';

/* 部分翻訳のフォールバック：未翻訳のキーは既定言語（ja）の文言で埋める。
   これで t() だけでなく zone/finger/note_names の参照も穴が空かない。 */
if ($LANG !== APP_DEFAULT_LANG) {
  $T = array_replace_recursive(require APP_ROOT . '/includes/lang/' . APP_DEFAULT_LANG . '.php', $T);
}

/* ===== 3. テンプレート用ヘルパ ===== */
if (!function_exists('h')) {
  function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
}
if (!function_exists('t')) {
  /* 'ui.menu' のようにドットで引く。可変引数を渡すと vsprintf する */
  function t(string $key, ...$args) {
    $v = $GLOBALS['T'];
    foreach (explode('.', $key) as $k) {
      if (!is_array($v) || !array_key_exists($k, $v)) return $key;
      $v = $v[$k];
    }
    if (!is_string($v)) return $v;
    return $args ? vsprintf($v, $args) : $v;
  }
}
if (!function_exists('e')) {
  function e(string $key, ...$args): void { echo h(t($key, ...$args)); }
}
if (!function_exists('er')) {
  /* HTML を含む文言（キー末尾が _html のもの）専用。エスケープしない */
  function er(string $key, ...$args): void { echo t($key, ...$args); }
}

/* ===== 4. 各種パス・表示値 ===== */
$BASE     = '../../';                                   /* {言語}/{楽器}/ からルートまで */
$INST_NAME = t('instrument.' . $INSTRUMENT);            /* 言語別の楽器名 */
$NOTE_NAMES = midi_note_names($T);
$OPEN_LABELS = midi_open_labels($INST, $NOTE_NAMES);

/* 言語切替のリンク先（パス絶対）。設置ディレクトリを自動判定する */
$scriptDir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
$rootPath  = rtrim(dirname($scriptDir, 2), '/');        /* 例: /cello-finger */
$LANG_URLS = [];
foreach (APP_LANGS as $l) { $LANG_URLS[$l] = $rootPath . '/' . $l . '/' . $INSTRUMENT . '/'; }

/* hreflang 用の絶対URL */
$https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
       || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$host   = $_SERVER['HTTP_HOST'] ?? '';
$origin = $host ? (($https ? 'https' : 'http') . '://' . $host) : '';

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
