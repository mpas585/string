<?php
/*
  includes/legal.php — プライバシーポリシーのページの基幹。
  /{言語}/privacy/index.php から呼ばれる唯一の入口。

  呼び出し側で $LANG を定義しておくこと:
      $LANG = 'ja';
      require __DIR__ . '/../../includes/legal.php';

  組み立ては includes/home.php と同じで、ビューだけ別（includes/views/legal.php）。
  文言は includes/lang/*.php の 'legal'。節を足すときは lang 側の legal.sections に
  配列を足せばここもビューも触らなくてよい。

  ※ Google Play の「アカウント削除のウェブリンク」には、このページの
     #delete（legal.sections で anchor に delete を付けた節）を登録する。
*/
if (!defined('STRING_APP')) { define('STRING_APP', 1); }
if (!defined('APP_ROOT'))   { define('APP_ROOT', dirname(__DIR__)); }

/* 直接 URL で叩かれた場合は拒否（$LANG が無いまま既定のページを配信してしまうため） */
if (realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'] ?? '')) { http_response_code(403); exit; }

$URL_DEPTH = 2;                                         /* 公開URLは /{言語}/privacy/ の2階層 */
require __DIR__ . '/bootstrap.php';

/* このページの各言語版URL（言語切替と hreflang に使う） */
$LANG_URLS = [];
foreach (APP_LANGS as $l) { $LANG_URLS[$l] = $rootPath . '/' . $l . '/privacy/'; }

/* 戻り先は言語別トップ（楽器選択） */
$HOME_URL = $rootPath . '/' . $LANG . '/';

$JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

app_send_csp();                                         /* 読み込み先は同一サーバのみ（bootstrap.php） */
header('Content-Type: text/html; charset=UTF-8');
require APP_ROOT . '/includes/views/legal.php';
