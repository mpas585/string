<?php
/*
  /es/viola/ — 言語と楽器を指定して基幹PHPを呼ぶだけ。
  画面の中身は includes/string_instrument.php、
  楽器の定義は config/viola.php、文言は includes/lang/es.php。
*/
$LANG       = 'es';
$INSTRUMENT = 'viola';
require __DIR__ . '/../../includes/string_instrument.php';
