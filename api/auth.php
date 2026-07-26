<?php
/*
  api/auth.php — 会員（ニックネーム＋暗証番号4桁）の JSON API。

    GET  ?action=me                              … ログイン状態を返す
    POST  action=register  nick= pin= lang=      … 登録してそのままログイン
    POST  action=login     nick= pin= lang=      … ログイン
    POST  action=logout    lang=                 … ログアウト

  応答は {"ok":true,"user":{"nick":"…"},"message":"…"} 形式。
  更新系は POST かつ 同一オリジンからの fetch（X-Requested-With: fetch）に限る＝素のフォーム送信では叩けない。
  実処理は includes/auth.php。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_POST['lang'] ?? $_GET['lang'] ?? '';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';
require APP_ROOT . '/includes/auth.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

function out(array $a): void {
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function err(string $code, ...$args): void {
  out(['ok' => false, 'error' => $code, 'message' => t('account.err.' . $code, ...$args)]);
}

$action = $_POST['action'] ?? $_GET['action'] ?? 'me';

/* 更新系の入口チェック（CSRF よけ） */
if ($action !== 'me') {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')            { http_response_code(405); err('method'); }
  if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch')    { http_response_code(403); err('method'); }
  $o = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($o !== '' && $origin !== '' && $o !== $origin)            { http_response_code(403); err('method'); }
}

try {
  switch ($action) {

    case 'me': {
      $u = auth_current();
      out(['ok' => true, 'user' => $u ? ['nick' => $u['nick']] : null]);
    }

    case 'register': {
      $r = auth_register((string)($_POST['nick'] ?? ''), (string)($_POST['pin'] ?? ''));
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'user' => ['nick' => $r['user']['nick']], 'message' => t('account.ok.registered', $r['user']['nick'])]);
    }

    case 'login': {
      $r = auth_login((string)($_POST['nick'] ?? ''), (string)($_POST['pin'] ?? ''));
      if (!$r['ok']) {
        if ($r['error'] === 'locked') err('locked', $r['wait'] ?? 5);
        err($r['error']);
      }
      out(['ok' => true, 'user' => ['nick' => $r['user']['nick']], 'message' => t('account.ok.login', $r['user']['nick'])]);
    }

    case 'logout': {
      auth_logout();
      out(['ok' => true, 'user' => null, 'message' => t('account.ok.logout')]);
    }
  }
  http_response_code(400);
  err('method');

} catch (Throwable $ex) {
  /* 例外の中身は返さない（DBパス等が漏れるため）。詳細はサーバのエラーログで見る */
  error_log('[GEN strings auth] ' . $ex->getMessage());
  http_response_code(500);
  err('server');
}
