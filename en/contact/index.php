<?php
/*
  /en/contact/ — Contact。言語だけ指定して基幹PHPを呼ぶ。
  画面の中身は includes/views/contact.php、文言は includes/lang/en.php の 'contact'。
*/
$LANG = 'en';
require __DIR__ . '/../../includes/contact.php';
