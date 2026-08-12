<?php
/*
  tools/merge_slurs.php — もとデータ（3500円ソフトのXML）から取り出したスラーを、
  すでにマスターアカウントへ入っている譜面へ「あとから足す」1回きりの道具。

  ・元データと現データをイベント列で突合済みの結果（tools/slurs_patch.json）を読み、
    行を name＋旧sig で本人確認してから、data にスラー（"slurs"）を足し、sig を計算し直す。
  ・鳴る音・音符の数・運指（fing列）は一切変えない。scoreSig（運指の保存キー）は
    曲名＋音数＋最初/最後の音でできており、スラーを足しても変わらないので運指は生きたまま。
  ・旧sig で確認するので、取り違えて別の譜面を書き換えることはない。
  ・すでにスラーが入っている（"slurs" を含む／新sigになっている）行は飛ばす＝何度実行しても増えも壊れもしない。

  使いかた:
    1. このファイルと tools/slurs_patch.json をサーバの同じ場所へ置く
    2. ブラウザでマスターアカウントにログインしておく
    3. https://（このサイト）/tools/merge_slurs.php を開く
    4. 済んだら【この2つのファイルをサーバから消す】
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

$file = __DIR__ . '/slurs_patch.json';
if (!is_readable($file)) { http_response_code(500); exit("slurs_patch.json が見つかりません。\n"); }
$rows = json_decode((string)file_get_contents($file), true);
if (!is_array($rows)) { http_response_code(500); exit("slurs_patch.json を読めません。\n"); }

/* data の指紋。src/uploads.js の sigOf / drawer.js の scoreSig と同じ作り（32bit → 36進）。
   JS: h=(h*31+charCode)|0 を繰り返し、最後に (h>>>0).toString(36)。
   64bit の PHP なら各ステップで 0xFFFFFFFF マスクすれば同じ値になる（ASCII なので ord=charCode）。 */
function sig_of(string $s): string {
  $h = 0;
  $len = strlen($s);
  for ($i = 0; $i < $len; $i++) {
    $h = (($h * 31) + ord($s[$i])) & 0xFFFFFFFF;
  }
  if ($h === 0) return '0';
  $digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  $out = '';
  while ($h > 0) { $out = $digits[$h % 36] . $out; $h = intdiv($h, 36); }
  return $out;
}

$db   = acc_db();
score_table($db);
$code = (string)$me['data_key'];
$now  = time();

$sel = $db->prepare('SELECT id, name, notes, data, sig FROM scores WHERE code = ? AND name = ?');
$upd = $db->prepare('UPDATE scores SET data = ?, sig = ?, updated_at = ? WHERE id = ?');

$done = 0; $already = 0; $notfound = 0; $changed = 0; $noslur = 0; $mismatch = 0;

foreach ($rows as $r) {
  $name    = (string)($r['name']     ?? '');
  $oldSig  = (string)($r['old_sig']  ?? '');
  $newSig  = (string)($r['new_sig']  ?? '');
  $newData = (string)($r['data']     ?? '');
  $groups  = (int)   ($r['groups']   ?? 0);
  if ($name === '' || $newData === '' || $newSig === '') { continue; }

  /* スラーが無い曲は何も足すものがない（触らない） */
  if ($groups === 0) { $noslur++; continue; }

  $sel->execute([$code, $name]);
  $found = $sel->fetchAll();
  if (!$found) { $notfound++; echo "見つからない: {$name}\n"; continue; }

  $hit = null;
  foreach ($found as $row) {
    if ((string)$row['sig'] === $oldSig) { $hit = $row; break; }   /* 旧sigで本人確認 */
    if ((string)$row['sig'] === $newSig) { $hit = $row; break; }   /* すでに更新済み */
  }
  if (!$hit) {
    /* 名前はあるが sig が旧でも新でもない＝インポート後に中身が変わっている。安全のため触らない。 */
    $mismatch++; echo "中身が変わっているため飛ばす: {$name}\n"; continue;
  }

  if ((string)$hit['sig'] === $newSig || strpos((string)$hit['data'], '"slurs"') !== false) {
    $already++; continue;                                          /* もう入っている */
  }

  /* sig の再計算が JS と一致するか、この場で自己検証してから書く（ズレていたら書かない） */
  if (sig_of($newData) !== $newSig) {
    $mismatch++; echo "sig不一致のため飛ばす: {$name}\n"; continue;
  }

  $upd->execute([$newData, $newSig, $now, (int)$hit['id']]);
  $done++;
  echo "スラー追加: {$name}（{$groups}群）\n";
}

echo "\n----\n";
echo "スラーを足した数: {$done}\n";
echo "すでに入っていた数: {$already}\n";
echo "スラーが無い曲（対象外）: {$noslur}\n";
if ($notfound) echo "名前が見つからなかった数: {$notfound}\n";
if ($mismatch) echo "中身が変わっている等で飛ばした数: {$mismatch}\n";
echo "\n済んだら tools/merge_slurs.php と tools/slurs_patch.json をサーバから消してください。\n";
