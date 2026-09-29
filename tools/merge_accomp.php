<?php
/*
  tools/merge_accomp.php — マスターアカウントに入っている「3500円ソフトのXML」由来の譜面へ、
  もとの MusicXML に入っていた伴奏パート（教本二重奏の先生パート等）を「あとから足す」1回きりの道具。
  あわせて、Rick Mooney『Thumb Position for Cello』由来の譜面の名前に「 (Thumb Position)」を添える。

  ・中身は tools/accomp_patch.json（元の XML から作って、現データと1件ずつ突合済み）。
  ・行は name＋旧sig で本人確認してから書き換える。旧sig でも新sig でもない行
    （インポート後に中身が変わっている）は触らない。
  ・data に "accomp"（伴奏パート）を足し、sig を計算し直す。
      guide_changed=false … 別パートが伴奏だった曲。練習する旋律・音数・スラーは変えない＝運指はそのまま。
      guide_changed=true  … 1段目（生徒）と2段目（先生）が1つのパートに混ざって和音になっていた曲。
                            旋律を1段目だけに戻し、2段目を伴奏へ移す。音符の並びが変わるので
                            保存してあった運指（fing 列）は空に戻す＝開いたときに自動で付け直る。
  ・data が null の行は名前だけ変える（伴奏の無い Thumb Position Pattern は名前にもう入っているので対象外）。
  ・すでに済んでいる行（新しい名前＋新sig）は飛ばす＝何度実行しても増えも壊れもしない。

  使いかた:
    1. このファイルと tools/accomp_patch.json をサーバの同じ場所へ置く
    2. ブラウザでマスターアカウントにログインしておく
    3. https://（このサイト）/tools/merge_accomp.php を開く
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

$file = __DIR__ . '/accomp_patch.json';
if (!is_readable($file)) { http_response_code(500); exit("accomp_patch.json が見つかりません。\n"); }
$rows = json_decode((string)file_get_contents($file), true);
if (!is_array($rows)) { http_response_code(500); exit("accomp_patch.json を読めません。\n"); }

/* data の指紋。src/uploads.js の sigOf と同じ作り（32bit → 36進）。tools/merge_slurs.php と同じ。 */
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

$sel     = $db->prepare('SELECT id, name, sig FROM scores WHERE code = ? AND (name = ? OR name = ?)');
$updData = $db->prepare('UPDATE scores SET name = ?, notes = ?, data = ?, sig = ?, updated_at = ? WHERE id = ?');
$updFull = $db->prepare('UPDATE scores SET name = ?, notes = ?, data = ?, sig = ?, fing = \'\', updated_at = ? WHERE id = ?');
$updName = $db->prepare('UPDATE scores SET name = ?, updated_at = ? WHERE id = ?');

$accomp = 0; $regroup = 0; $renamed = 0; $already = 0; $notfound = 0; $mismatch = 0;

$db->beginTransaction();
try {
  foreach ($rows as $r) {
    $name    = (string)($r['name']     ?? '');
    $newName = (string)($r['new_name'] ?? $name);
    $oldSig  = (string)($r['old_sig']  ?? '');
    $newSig  = (string)($r['new_sig']  ?? '');
    $data    = isset($r['data']) && is_string($r['data']) ? $r['data'] : null;
    $notes   = (int)($r['notes'] ?? 0);
    $regrp   = !empty($r['guide_changed']);
    if ($name === '' || $newName === '' || $oldSig === '' || $newSig === '') continue;

    $sel->execute([$code, $name, $newName]);
    $found = $sel->fetchAll();
    if (!$found) { $notfound++; echo "見つからない: {$name}\n"; continue; }

    $hit = null; $done = false;
    foreach ($found as $row) {
      if ((string)$row['name'] === $newName && (string)$row['sig'] === $newSig) { $hit = $row; $done = true; break; }
    }
    if (!$hit) {
      foreach ($found as $row) {
        if ((string)$row['sig'] === $oldSig || (string)$row['sig'] === $newSig) { $hit = $row; break; }
      }
    }
    if (!$hit) { $mismatch++; echo "中身が変わっているため飛ばす: {$name}\n"; continue; }
    if ($done)  { $already++; continue; }

    if ($data === null) {
      $updName->execute([$newName, $now, (int)$hit['id']]);
      $renamed++;
      echo "名前だけ変更: {$name} → {$newName}\n";
      continue;
    }

    /* 書く前に、sig の再計算が JS と一致するかをこの場で確かめる（ズレていたら書かない） */
    if (sig_of($data) !== $newSig || !is_array(json_decode($data, true)) || $notes <= 0) {
      $mismatch++; echo "sig不一致のため飛ばす: {$name}\n"; continue;
    }

    if ($regrp) {
      $updFull->execute([$newName, $notes, $data, $newSig, $now, (int)$hit['id']]);
      $regroup++;
      echo "旋律と伴奏を分けた（運指は付け直し）: {$newName}\n";
    } else {
      $updData->execute([$newName, $notes, $data, $newSig, $now, (int)$hit['id']]);
      $accomp++;
      echo "伴奏を追加: {$newName}\n";
    }
    if ($newName !== $name) $renamed++;
  }
  $db->commit();
} catch (Throwable $e) {
  $db->rollBack();
  http_response_code(500);
  exit("失敗したので何も変えていません: " . $e->getMessage() . "\n");
}

echo "\n----\n";
echo "伴奏を足した数（旋律はそのまま）: {$accomp}\n";
echo "旋律と伴奏を分けた数（運指は付け直し）: {$regroup}\n";
echo "名前に (Thumb Position) を添えた数: {$renamed}\n";
echo "すでに済んでいた数: {$already}\n";
if ($notfound) echo "名前が見つからなかった数: {$notfound}\n";
if ($mismatch) echo "中身が変わっている等で飛ばした数: {$mismatch}\n";
echo "\n済んだら tools/merge_accomp.php と tools/accomp_patch.json をサーバから消してください。\n";
