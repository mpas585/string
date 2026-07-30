<?php
/*
  index.php（ルート） — サイトのホームページ。言語を判定してトップの中身をそのまま出す。

  ※ 以前はここで /{言語}/ へ 302 転送していたが、それをやめた。
     Google は検索結果の「サイト名」を【ルートURI（＝このページ）】に置かれた
     WebSite 構造化データから決める仕様で、/{言語}/ に置いたものは見てくれない
     （公式ドキュメント: ホームページとはドメイン／サブドメインのルートURI。
       https://example.com/de/index.html はホームページではない）。
     ルートが転送だと構造化データを拾えず、相乗りしている親ドメイン側の名前
     （genstrings.sakura.ne.jp → さくらインターネット）が使われてしまう。

  中身は /{言語}/index.php と同じ includes/home.php。
  正規URL（canonical）は従来どおり /{言語}/ のままで、このページはその重複として扱う
  （Google のサイト名の項に「重複するホームページすべてに同じ構造化データを置く」とあるため、
    正規化を崩さずにルートへ構造化データを置ける）。
  hreflang の x-default が指す言語中立URLでもある。
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

/* 同じURLで言語が変わることをキャッシュ／クローラに伝える */
header('Vary: Accept-Language');

$LANG      = $lang;
$URL_DEPTH = 0;         /* ここがルート */
require __DIR__ . '/includes/home.php';
