<?php
/*
  /zh/cello/ — 言語と楽器を指定して基幹PHPを呼ぶだけ。
  画面の中身は includes/string_instrument.php、
  楽器の定義は config/cello.php、文言は includes/lang/zh.php。
*/
$LANG       = 'zh';
$INSTRUMENT = 'cello';
require __DIR__ . '/../../includes/string_instrument.php';
