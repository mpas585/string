<?php
/*
  config/app.php — 対応言語・対応楽器の唯一の定義。

  ここを直せば全体に効く（ルートの index.php も基幹PHPもこのファイルを読む）。

  言語を足すとき:
    1. このファイルの 'langs' に追加
    2. includes/lang/{言語}.php を作る（ja.php を写して訳す。訳し漏れは ja で自動フォールバック）
    3. /{言語}/{楽器}/index.php を楽器の数だけ作る（中身は3行）

  楽器を足すとき:
    1. このファイルの 'instruments' に追加
    2. config/{楽器}.php を作る
    3. includes/lang/*.php の 'instrument' に楽器名を追加
    4. /{言語}/{楽器}/index.php を言語の数だけ作る
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

return [
  'langs'              => ['ja', 'en', 'es', 'zh'],
  'instruments'        => ['cello', 'violin', 'viola'],
  /* 一覧に無い値が来たときの既定。ルートの / からの転送先もこの組み合わせ */
  'default_lang'       => 'ja',
  'default_instrument' => 'cello',
];
