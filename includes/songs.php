<?php
/*
  includes/songs.php — 曲の紹介ページ（検索エンジン向けの入口）の基幹。
  /{言語}/songs/index.php から呼ばれる唯一の入口。

  やること:
    ・?s=<曲id> があれば「その曲の詳細ページ」、無ければ「曲一覧ページ」を出す。
    ・掲載する曲は public/songs/manifest.json をそのまま読む
      （＝曲を足す／消すと、この一覧も各曲ページも自動で増減する。ここは触らなくてよい）。
    ・本文の文言は includes/songs_lang.php（このページ専用のコピー。本体の辞書とは別ファイル）。
      楽器名・サイト名など共通のものは bootstrap.php が読む $T / 定数を使う。

  呼び出し側で $LANG を定義しておくこと:
      $LANG = 'ja';
      require __DIR__ . '/../../includes/songs.php';

  クリーンURL（/{言語}/songs/<曲id>/）は各 songs/ ディレクトリの .htaccess が
  index.php?s=<曲id> に読み替えている（ルートの .htaccess とは独立）。
*/
if (!defined('STRING_APP')) { define('STRING_APP', 1); }
if (!defined('APP_ROOT'))   { define('APP_ROOT', dirname(__DIR__)); }

/* 直接 URL で叩かれた場合は拒否（$LANG が無いまま既定のページを配信してしまうため） */
if (realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'] ?? '')) { http_response_code(403); exit; }

$URL_DEPTH = 2;                                    /* 物理URLは /{言語}/songs/ の2階層 */
require __DIR__ . '/bootstrap.php';                /* $LANG $T $BASE $rootPath $origin ほか */

/* このページ専用の文言（曲一覧・曲詳細のコピーだけ）。未訳キーは既定言語で埋める */
$SL_ALL = require APP_ROOT . '/includes/songs_lang.php';
$SL = $SL_ALL[$LANG] ?? $SL_ALL[APP_DEFAULT_LANG];
if ($LANG !== APP_DEFAULT_LANG) { $SL = array_replace($SL_ALL[APP_DEFAULT_LANG], $SL); }

/* 曲一覧（manifest.json）。読めなければ空一覧として扱う（例外は投げない） */
$SONGS = [];
$mf = @file_get_contents(APP_ROOT . '/public/songs/manifest.json');
if ($mf !== false) {
  $j = json_decode($mf, true);
  if (is_array($j) && isset($j['songs']) && is_array($j['songs'])) { $SONGS = $j['songs']; }
}

/* id -> 曲 の索引。id は英数と _ - のみ許可（URLにそのまま出すため。危険な文字は弾く） */
$BYID = [];
foreach ($SONGS as $s) {
  if (!isset($s['id']) || !preg_match('/^[A-Za-z0-9_-]+$/', $s['id'])) { continue; }
  $BYID[$s['id']] = $s;
}

/* 表示言語で曲名／説明を引く（無ければ既定言語、それも無ければ最初の値） */
$pick = function ($m) use ($LANG) {
  if (!is_array($m)) { return (string)$m; }
  if (isset($m[$LANG]))            { return (string)$m[$LANG]; }
  if (isset($m[APP_DEFAULT_LANG])) { return (string)$m[APP_DEFAULT_LANG]; }
  $v = reset($m);
  return $v === false ? '' : (string)$v;
};

/* 難易度（1..3）の表示名。範囲外は素の数字を返す */
$levelName = function ($lv) use ($SL) {
  $lv = (int)$lv;
  return isset($SL['levels'][$lv]) ? $SL['levels'][$lv] : (string)$lv;
};

/* 要求された曲 */
$reqId = isset($_GET['s']) ? preg_replace('/[^A-Za-z0-9_-]/', '', (string)$_GET['s']) : '';
$song  = ($reqId !== '' && isset($BYID[$reqId])) ? $BYID[$reqId] : null;

/* 各言語版のこのページのURL（hreflang と言語切替に使う） */
$songsBase = function ($l) use ($rootPath) { return $rootPath . '/' . $l . '/songs/'; };
$LANG_URLS = [];
if ($song) {
  foreach (APP_LANGS as $l) { $LANG_URLS[$l] = $songsBase($l) . $reqId . '/'; }
} else {
  foreach (APP_LANGS as $l) { $LANG_URLS[$l] = $songsBase($l); }
}
$SONGS_HOME = $rootPath . '/' . $LANG . '/songs/';   /* 曲一覧へ戻る */
$HOME_URL   = $rootPath . '/' . $LANG . '/';          /* 楽器選択トップへ戻る */

$JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

app_send_csp();                                       /* 読み込み先は同一サーバ＋許可済みのみ */
header('Content-Type: text/html; charset=UTF-8');

/* 指定された曲IDが manifest に無い（消された等）ときは 404 を返し、一覧へ誘導する */
if ($reqId !== '' && !$song) { http_response_code(404); }

if ($song) {
  require APP_ROOT . '/includes/views/songs_detail.php';
} else {
  require APP_ROOT . '/includes/views/songs_index.php';
}
