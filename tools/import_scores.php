<?php
/*
  tools/import_scores.php — 添付の MusicXML を「アップロードした譜面」として
  マスターアカウント（config/app.php の admin_email）に一括で入れる、1回きりの道具。

  使いかた:
    1. このファイルと tools/import_scores.json をサーバの同じ場所へ置く
    2. ブラウザでマスターアカウントにログインしておく
    3. https://（このサイト）/tools/import_scores.php を開く
    4. 済んだら【この2つのファイルをサーバから消す】

  ・入れる中身は画面から読み込んだときとまったく同じ形にしてある
    （src/songs.js の parseMusicXML → src/uploads.js の packScore / sigOf を通した結果を
      import_scores.json に書き出してある）。運指は付けない＝開いたときに自動で付く。
  ・同じ sig（内容の指紋）の行が既にあるものは飛ばす＝何度実行しても増えない。
  ・件数の上限はマスターアカウントぶん（includes/scores.php の SCORE_MAX_ITEMS_ADMIN）を見る。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = 'ja';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';
require APP_ROOT . '/includes/account.php';
require APP_ROOT . '/includes/scores.php';

header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');

acc_session_start();
$me = acc_current();
if (!$me) { http_response_code(401); exit("ログインしていません。マスターアカウントでログインしてから開いてください。\n"); }
if (APP_ADMIN_EMAIL === '' || strtolower((string)$me['email']) !== APP_ADMIN_EMAIL) {
  http_response_code(403);
  exit("マスターアカウント（config/app.php の admin_email）ではありません。\n");
}

$file = __DIR__ . '/import_scores.json';
if (!is_readable($file)) { http_response_code(500); exit("import_scores.json が見つかりません。\n"); }
$rows = json_decode((string)file_get_contents($file), true);
if (!is_array($rows)) { http_response_code(500); exit("import_scores.json を読めません。\n"); }

$db = acc_db();
score_table($db);
$code = (string)$me['data_key'];
$max  = score_max_items($me);

/* 既に入っている sig を集めておく（重ねて実行しても増やさないため） */
$have = [];
$st = $db->prepare('SELECT sig FROM scores WHERE code = ?');
$st->execute([$code]);
foreach ($st->fetchAll() as $r) { $have[(string)$r['sig']] = true; }

$count = (int)$db->query('SELECT COUNT(*) FROM scores WHERE code = ' . $db->quote($code))->fetchColumn();
$now   = time();
$ins   = $db->prepare('INSERT INTO scores (code, name, sub, notes, data, sig, fing, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');

$added = 0; $skip = 0; $full = 0;
foreach ($rows as $r) {
  $name  = (string)($r['name'] ?? '');
  $notes = (int)   ($r['notes'] ?? 0);
  $data  = (string)($r['data'] ?? '');
  $sig   = (string)($r['sig']  ?? '');
  if ($name === '' || $data === '' || $sig === '') { $skip++; continue; }
  if (isset($have[$sig]))                          { $skip++; continue; }
  if ($count >= $max)                              { $full++; continue; }

  $ins->execute([$code, $name, '', $notes, $data, $sig, '', '', $now, $now]);
  $have[$sig] = true;
  $count++; $added++;
  echo "追加: {$name}\n";
}

echo "\n----\n";
echo "追加した数: {$added}\n";
echo "飛ばした数（既にある・中身が空）: {$skip}\n";
if ($full > 0) echo "上限（{$max}件）で入らなかった数: {$full}\n";
echo "いまの合計: {$count} / {$max}\n";
echo "\n済んだら tools/import_scores.php と tools/import_scores.json をサーバから消してください。\n";
