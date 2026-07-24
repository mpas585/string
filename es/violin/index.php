<?php
/*
  /es/violin/ — 言語と楽器を指定して基幹PHPを呼ぶだけ。
  画面の中身は includes/string_instrument.php、
  楽器の定義は config/violin.php、文言は includes/lang/es.php。
*/
$LANG       = 'es';
$INSTRUMENT = 'violin';
require __DIR__ . '/../../includes/string_instrument.php';
