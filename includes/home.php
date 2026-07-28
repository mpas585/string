<?php
/*
  includes/home.php — 言語別トップ（楽器選択）の基幹。/{言語}/index.php から呼ばれる。

  呼び出し側で $LANG を定義しておくこと:
      $LANG = 'ja';
      require __DIR__ . '/../includes/home.php';

  やることは bootstrap の読み込みとビューの呼び出しだけ。HTML は includes/views/home.php。
*/
if (!defined('STRING_APP')) { define('STRING_APP', 1); }
if (!defined('APP_ROOT'))   { define('APP_ROOT', dirname(__DIR__)); }

/* 直接 URL で叩かれた場合は拒否（$LANG が無いまま既定のページを二重に配信してしまうため） */
if (realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'] ?? '')) { http_response_code(403); exit; }

$URL_DEPTH = 1;                                         /* 公開URLは /{言語}/ の1階層 */
require __DIR__ . '/bootstrap.php';

$JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

app_send_csp();                                         /* 読み込み先は同一サーバのみ（bootstrap.php） */
header('Content-Type: text/html; charset=UTF-8');
require APP_ROOT . '/includes/views/home.php';
