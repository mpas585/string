<?php
/*
  api/auth.php — 保存番号（英字1文字＋数字4桁）の JSON API。

    POST  action=create  payload= lang=          … 保存番号を発行して、いまの設定を預ける
    POST  action=load    code=    lang=          … 保存番号の設定を取り出す
    POST  action=save    code= payload= lang=    … 保存番号の設定を上書きする
    POST  action=delete  code=    lang=          … 保存データを消す

  応答は {"ok":true,"code":"G4821","payload":{…},"message":"…"} 形式。
  保存番号は URL に出さない（履歴・アクセスログ・Referer に残さないため）＝全て POST。
  同一オリジンからの fetch（X-Requested-With: fetch）に限る＝素のフォーム送信では叩けない。
  実処理は includes/auth.php。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_POST['lang'] ?? '';
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
  out(['ok' => false, 'error' => $code, 'message' => t('save.err.' . $code, ...$args)]);
}

/* 入口チェック（CSRF よけ）。読み出しも含めて全て POST なので例外は作らない */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')         { http_response_code(405); err('method'); }
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') { http_response_code(403); err('method'); }
$o = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($o !== '' && $origin !== '' && $o !== $origin)         { http_response_code(403); err('method'); }

$action  = (string)($_POST['action']  ?? '');
$code    = (string)($_POST['code']    ?? '');
$payload = (string)($_POST['payload'] ?? '');

try {
  switch ($action) {

    case 'create': {
      $r = save_create($payload);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'code' => $r['code'], 'message' => t('save.ok.created')]);
    }

    case 'load': {
      $r = save_load($code);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'code' => $r['code'], 'payload' => $r['payload'], 'message' => t('save.ok.loaded')]);
    }

    case 'save': {
      $r = save_update($code, $payload);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'code' => $r['code']]);
    }

    case 'delete': {
      $r = save_delete($code);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'message' => t('save.ok.deleted')]);
    }
  }
  http_response_code(400);
  err('method');

} catch (Throwable $ex) {
  /* 例外の中身は返さない（DBパス等が漏れるため）。詳細はサーバのエラーログで見る */
  error_log('[GEN strings save] ' . $ex->getMessage());
  http_response_code(500);
  err('server');
}
