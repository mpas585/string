<?php
/*
  api/scores.php — アップロードした楽譜（保存番号に紐づく譜面）の JSON API。

    POST  action=list    code= lang=                                    … 一覧（新しい順・data は返さない）
    POST  action=save    code= name= notes= data= sig= fing= id= lang=  … 1件保存
                                                                          id を付けるとその1件を上書き、
                                                                          付けなければ新しく追加する
    POST  action=fing    code= id= fing= lang=                          … 運指だけ更新（sig は変わらない）
    POST  action=load    code= id=   lang=                              … 1件取り出す（運指も返す）
    POST  action=delete  code= id=   lang=                              … 1件消す

  応答は {"ok":true,…} 形式。保存番号は URL に出さない（履歴・アクセスログ・Referer に
  残さないため）＝読み出しも含めて全て POST。同一オリジンからの fetch に限る。
  実処理は includes/scores.php（保存番号の検証・レート制限は includes/auth.php と共通）。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_POST['lang'] ?? '';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';
require APP_ROOT . '/includes/auth.php';
require APP_ROOT . '/includes/scores.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

function out(array $a): void {
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function err(string $code, ...$args): void {
  out(['ok' => false, 'error' => $code, 'message' => t('save.err.' . $code, ...$args)]);
}

/* 入口チェック（CSRF よけ）。api/auth.php と同じ条件にそろえてある */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')         { http_response_code(405); err('method'); }
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') { http_response_code(403); err('method'); }
$o = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($o !== '' && $origin !== '' && $o !== $origin)         { http_response_code(403); err('method'); }

$action = (string)($_POST['action'] ?? '');
$code   = (string)($_POST['code']   ?? '');
$id     = (int)   ($_POST['id']     ?? 0);
$name   = (string)($_POST['name']   ?? '');
$notes  = (int)   ($_POST['notes']  ?? 0);
$data   = (string)($_POST['data']   ?? '');
$sig    = (string)($_POST['sig']    ?? '');
$fing   = (string)($_POST['fing']   ?? '');

try {
  switch ($action) {

    case 'list': {
      $r = score_list($code);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'items' => $r['items']]);
    }

    case 'save': {
      $r = score_save($code, $name, $notes, $data, $sig, $fing, $id);
      if (!$r['ok']) err($r['error'], SCORE_MAX_ITEMS);
      out(['ok' => true, 'id' => $r['id'], 'mode' => $r['mode']]);
    }

    case 'fing': {
      $r = score_fing($code, $id, $fing);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'id' => $r['id']]);
    }

    case 'load': {
      $r = score_load($code, $id);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'id' => $r['id'], 'name' => $r['name'], 'data' => $r['data'], 'fing' => $r['fing']]);
    }

    case 'delete': {
      $r = score_delete($code, $id);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'id' => $r['id']]);
    }
  }
  http_response_code(400);
  err('method');

} catch (Throwable $ex) {
  /* 例外の中身は返さない（DBパス等が漏れるため）。詳細はサーバのエラーログで見る */
  error_log('[GEN strings scores] ' . $ex->getMessage());
  http_response_code(500);
  err('server');
}
