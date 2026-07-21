<?php
/*
  index.php（ルート） — 言語を判定して /{言語}/{既定楽器}/ へ転送するだけ。
  ページ本体は /{言語}/{楽器}/index.php → includes/string_instrument.php。
*/
define('STRING_APP', 1);
$APP     = require __DIR__ . '/config/app.php';
$langs   = $APP['langs'];
$default = $APP['default_lang'];

/* ?lang=en のような明示指定を優先、次にブラウザの Accept-Language */
$lang = $_GET['lang'] ?? '';
if (!in_array($lang, $langs, true)) {
  $lang = $default;
  $accept = strtolower($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
  foreach (explode(',', $accept) as $part) {
    $tag = trim(explode(';', $part)[0]);
    if ($tag === '') continue;
    $primary = explode('-', $tag)[0];
    if (in_array($primary, $langs, true)) { $lang = $primary; break; }
  }
}

header('Location: ./' . $lang . '/' . $APP['default_instrument'] . '/', true, 302);
exit;
