<?php
/*
  /en/songs/ — 曲の紹介ページ（検索エンジン向けの入口）。言語だけ指定して基幹PHPを呼ぶ。
  ?s=<曲id> があればその曲の詳細、無ければ曲一覧。中身は includes/songs.php。
  クリーンURL（/en/songs/<曲id>/）は同ディレクトリの .htaccess が index.php?s=… に読み替える。
*/
$LANG = 'en';
require __DIR__ . '/../../includes/songs.php';
