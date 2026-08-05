<?php
/*
  api/shares.php — 共有された楽譜（みんなの曲）の JSON API。

    GET/POST action=list    q= page=                        … 公開中の一覧（ログイン不要）
    GET/POST action=load    id=                             … 1件の譜面データ（ログイン不要）
    POST     action=share   csrf= id= name= agree=1         … 自分の譜面（scores の1件）を公開する
    POST     action=unshare csrf= id=                       … 自分の公開をやめる
    POST     action=report  csrf= id=                       … 削除依頼（受けた時点で非公開になる）
    POST     action=admin   csrf= sub=list|show|hide|delete id= q= page=
                                                            … 管理（config/app.php の admin_email だけ）

  一覧と読み出しだけは、ログインしていない人にも見せる必要があるので
  CSRF トークンもログインも要らない（公開された内容しか返さないため）。
  状態が変わる操作（share / unshare / report / admin）は
  api/account.php・api/scores.php と同じで POST ＋ X-Requested-With ＋ CSRF ＋ ログイン必須。

  応答は {"ok":true,…} 形式。実処理は includes/shares.php。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_POST['lang'] ?? $_GET['lang'] ?? '';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';
require APP_ROOT . '/includes/account.php';
require APP_ROOT . '/includes/scores.php';
require APP_ROOT . '/includes/shares.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

function out(array $a): void {
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function err(string $code, ...$args): void {
  out(['ok' => false, 'error' => $code, 'message' => t('acc.err.' . $code, ...$args)]);
}

$action = (string)($_POST['action'] ?? $_GET['action'] ?? '');
$id     = (int)   ($_POST['id']     ?? $_GET['id']     ?? 0);
$page   = (int)   ($_POST['page']   ?? $_GET['page']   ?? 1);
$q      = (string)($_POST['q']      ?? $_GET['q']      ?? '');
$name   = (string)($_POST['name']   ?? '');
$agree  = ((string)($_POST['agree'] ?? '') === '1');
$sub    = (string)($_POST['sub']    ?? '');

try {
  acc_session_start();
  $me = acc_current();

  /* ---- 誰でも見られるもの（公開された内容だけ） ---- */
  if ($action === 'list') {
    $r = share_list($q, $page, $me);
    out(['ok' => true, 'items' => $r['items'], 'total' => $r['total'], 'page' => $r['page'], 'per' => $r['per']]);
  }
  if ($action === 'load') {
    $r = share_load($id, $me);
    if (!$r['ok']) err($r['error']);
    out(['ok' => true, 'id' => $r['id'], 'name' => $r['name'], 'sub' => $r['sub'], 'notes' => $r['notes'], 'data' => $r['data']]);
  }

  /* ---- ここから先は状態が変わる操作 ---- */
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')         { http_response_code(405); err('method'); }
  if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') { http_response_code(403); err('method'); }
  $o = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($o !== '' && $origin !== '' && $o !== $origin)         { http_response_code(403); err('method'); }
  if (!acc_csrf_ok((string)($_POST['csrf'] ?? '')))          { http_response_code(403); err('method'); }
  if (!$me)                                                  { http_response_code(401); err('needlogin'); }

  switch ($action) {

    case 'share': {
      $r = share_create($me, $id, $name, $agree);
      if (!$r['ok']) err($r['error'], SHARE_MAX_ITEMS);
      out(['ok' => true, 'id' => $r['id'], 'message' => t('share.ok.shared')]);
    }

    case 'unshare': {
      $r = share_remove($me, $id);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'id' => $r['id'], 'message' => t('share.ok.unshared')]);
    }

    case 'report': {
      $r = share_report($me, $id);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'id' => $r['id'], 'message' => t('share.ok.reported')]);
    }

    case 'admin': {
      if (!share_is_admin($me)) { http_response_code(403); err('needlogin'); }
      if ($sub === 'list') {
        $r = share_admin_list($q, $page);
        out(['ok' => true, 'items' => $r['items'], 'total' => $r['total'], 'page' => $r['page'], 'per' => $r['per']]);
      }
      if ($sub === 'show' || $sub === 'hide') {
        $r = share_admin_status($id, ($sub === 'show') ? 'public' : 'hidden');
        if (!$r['ok']) err($r['error']);
        out(['ok' => true, 'id' => $r['id'], 'status' => $r['status']]);
      }
      if ($sub === 'delete') {
        $r = share_admin_delete($id);
        if (!$r['ok']) err($r['error']);
        out(['ok' => true, 'id' => $r['id']]);
      }
      http_response_code(400);
      err('method');
    }
  }
  http_response_code(400);
  err('method');

} catch (Throwable $ex) {
  /* 例外の中身は返さない（DBパス等が漏れるため）。詳細はサーバのエラーログで見る */
  error_log('[GEN strings shares] ' . $ex->getMessage());
  http_response_code(500);
  err('server');
}
