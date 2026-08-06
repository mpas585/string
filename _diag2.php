<?php
/*
  _diag2.php — 登録・ログインの例外の中身を、そのまま見るための一時ファイル。

  置き場所: サイトのルート直下（index.php と同じ階層）
  開き方  : https://genstrings.sakura.ne.jp/_diag2.php?k=8ac1784403f745c2
  ※ 原因が分かったら必ず削除してください。

  1本目の診断で、データベース・メール・言語ファイルはすべて正常でした。
  ということは、例外はそれより後で起きています。
  ここでは api/account.php と同じ手順を実際に走らせて、
  例外の種類・本文・ファイル・行番号をそのまま表示します。

  ・テストに使うのは diag-probe@example.com（example.com は配送されない予約ドメインなので
    実際にメールは飛びません）。作った行は最後に必ず消します。
  ・パスワードやメールアドレスの中身は表示しません。
*/
if (($_GET['k'] ?? '') !== '8ac1784403f745c2') { http_response_code(404); exit; }

header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');
/* セッションを後から開始しても警告が出ないよう、出力はいったん貯めておく */
ob_start();
error_reporting(E_ALL);
ini_set('display_errors', '0');

define('STRING_APP', 1);
define('APP_ROOT', __DIR__);
$LANG      = 'ja';
$URL_DEPTH = 0;

function line(string $s = ''): void { echo $s . "\n"; }
function ok(string $s): void   { line('  [OK]   ' . $s); }
function ng(string $s): void   { line('  [NG]   ' . $s); }
function info(string $s): void { line('  [--]   ' . $s); }

/* 例外を包み隠さず出す。ここが目的 */
function boom(Throwable $e): void {
  ng('★ ' . get_class($e));
  line('         本文: ' . $e->getMessage());
  line('         場所: ' . str_replace(APP_ROOT, '', $e->getFile()) . ' の ' . $e->getLine() . ' 行目');
  $n = 0;
  foreach ($e->getTrace() as $f) {
    if ($n++ >= 6) break;
    line('         ← ' . str_replace(APP_ROOT, '', $f['file'] ?? '?') . ':' . ($f['line'] ?? '?')
       . '  ' . ($f['function'] ?? '?') . '()');
  }
  if ($e->getPrevious()) { line('         --- もとの例外 ---'); boom($e->getPrevious()); }
}

line('================ GEN strings 診断 その2 ================');
line('日時: ' . date('Y-m-d H:i:s') . ' / PHP ' . PHP_VERSION);
line();

/* ---- 読み込み ---- */
line('[1] ファイルの読み込み');
try {
  require APP_ROOT . '/includes/bootstrap.php';
  ok('includes/bootstrap.php');
} catch (Throwable $e) { boom($e); exit; }
try {
  require APP_ROOT . '/includes/account.php';
  ok('includes/account.php');
} catch (Throwable $e) { boom($e); exit; }
line();

/* ---- テーブルの形 ---- */
line('[2] テーブルの形（列が足りているか）');
try {
  $db = acc_db();
  ok('acc_db() が通りました');
  foreach (['users', 'user_tokens', 'user_oauth', 'auth_hits', 'scores'] as $t) {
    $cols = [];
    foreach ($db->query("PRAGMA table_info($t)") as $c) $cols[] = $c['name'];
    if (!$cols) { info("$t: (無し)"); continue; }
    line("  $t: " . implode(', ', $cols));
  }
  $need = ['id','email','pass_hash','status','payload','data_key','sess_epoch','created_at','updated_at','last_login_at'];
  $have = [];
  foreach ($db->query('PRAGMA table_info(users)') as $c) $have[] = $c['name'];
  $miss = array_diff($need, $have);
  $miss ? ng('users に足りない列: ' . implode(', ', $miss)) : ok('users の列は揃っています');
} catch (Throwable $e) { boom($e); }
line();

/* ---- 文言の取り出し ---- */
line('[3] 文言（vsprintf のところ）');
foreach ([
  ['acc.err.signin', []],
  ['acc.err.server', []],
  ['acc.ok.signup',  []],
  ['acc.mail.verify_subject', []],
  ['acc.mail.verify_body', ['https://example.com/x?t=abc&lang=ja', 24]],
  ['acc.mail.reset_body',  ['https://example.com/y?t=abc&lang=ja', 60]],
  ['acc.mail.exists_body', ['https://example.com']],
] as [$key, $args]) {
  try {
    $v = t($key, ...$args);
    ok($key . ' → ' . substr(str_replace("\n", '/', (string)$v), 0, 60) . '…');
  } catch (Throwable $e) { ng($key . ' で失敗'); boom($e); }
}
line();

/* ---- 実際に登録してみる ---- */
line('[4] 登録（acc_signup）を実際に走らせる');
$probe = 'diag-probe@example.com';
try {
  $r = acc_signup($probe, 'diagprobe12345', 'ja');
  ok('例外なし → ' . json_encode($r, JSON_UNESCAPED_UNICODE));
} catch (Throwable $e) { boom($e); }
line();

/* ---- 実際にログインしてみる ---- */
line('[5] ログイン（acc_login）を実際に走らせる');
try {
  $u = acc_find($probe);
  if ($u) {
    acc_db()->prepare("UPDATE users SET status='active' WHERE id = ?")->execute([(int)$u['id']]);
    info('テスト用の行をログインできる状態にしました');
  } else {
    info('テスト用の行が作られていません（[4] で失敗している）');
  }
  $r = acc_login($probe, 'diagprobe12345');
  ok('例外なし → ' . json_encode(['ok' => $r['ok'], 'error' => $r['error'] ?? null], JSON_UNESCAPED_UNICODE));
} catch (Throwable $e) { boom($e); }
line();

/* ---- メール送信の設定 ---- */
line('[6] メール送信まわりの設定');
info('sendmail_path            : ' . (ini_get('sendmail_path') ?: '(未設定)'));
info('mail.force_extra_parameters: ' . (ini_get('mail.force_extra_parameters') ?: '(未設定)'));
info('mail.add_x_header        : ' . var_export((bool)ini_get('mail.add_x_header'), true));
line('  --- mail() を1回だけ試す（example.com なので実際には配送されません）---');
try {
  $r = acc_mail($probe, 'diag test', "test\n");
  $r ? ok('mail() は true を返しました') : ng('mail() は false を返しました（送信できていない）');
} catch (Throwable $e) { boom($e); }
line();

/* ---- 後始末 ---- */
line('[7] 後始末');
try {
  $u = acc_find($probe);
  if ($u) {
    acc_db()->prepare('DELETE FROM user_tokens WHERE user_id = ?')->execute([(int)$u['id']]);
    acc_db()->prepare('DELETE FROM users WHERE id = ?')->execute([(int)$u['id']]);
    ok('テスト用の行を削除しました');
  } else {
    info('消す行はありませんでした');
  }
  acc_db()->exec('DELETE FROM auth_hits');
  ok('レート制限の記録を消しました（試行回数をリセット）');
} catch (Throwable $e) { boom($e); }
line();

/* ---- いま入っているアカウント数 ---- */
line('[8] いまの登録状況');
try {
  foreach (['users' => 'アカウント', 'user_tokens' => '未使用のトークン', 'scores' => '預かっている譜面'] as $t => $jp) {
    try {
      info(sprintf('%-16s %s件', $jp, number_format((int)acc_db()->query("SELECT COUNT(*) FROM $t")->fetchColumn())));
    } catch (Throwable $e) { info($jp . ' … テーブルがまだありません'); }
  }
} catch (Throwable $e) { boom($e); }

line();
line('================ ここまで ================');
line('※ _diag.php と _diag2.php は、確認が済んだら削除してください。');
ob_end_flush();
