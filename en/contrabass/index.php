<?php
/*
  /en/contrabass/ — 言語と楽器を指定して基幹PHPを呼ぶだけ。
  画面の中身は includes/string_instrument.php、
  楽器の定義は config/contrabass.php、文言は includes/lang/en.php。
*/
$LANG       = 'en';
$INSTRUMENT = 'contrabass';
require __DIR__ . '/../../includes/string_instrument.php';
