<?php
/*
  api/scores.php — アップロードした楽譜（アカウントに紐づく譜面）の JSON API。

    POST  action=list    csrf= lang=                                    … 一覧（新しい順・data は返さない）
    POST  action=save    csrf= name= sub= notes= data= sig= fing= id= src= lang= inst= … 1件保存
                          src（元のMIDIのbase64）は送らなければ既存のまま
                                                                          id を付けるとその1件を上書き、
                                                                          付けなければ新しく追加する
    POST  action=fing    csrf= id= fing= lang= inst=                    … 運指だけ更新（sig は変わらない）
    POST  action=load    csrf= id=   lang= inst=                        … 1件取り出す（運指も返す）
    POST  action=delete  csrf= id=   lang=                              … 1件消す

  inst（楽器名）は運指の出し入れにだけ使う。運指は弦とポジションの番号なので楽器ごとに
  分けて持つ必要があるため（実際の振り分けは includes/scores.php の score_fing_* が行う）。
  譜面そのものは楽器で分けない＝一覧はどの楽器から見ても同じものが出る。

  誰の譜面かはログイン中のセッションから決める（画面から保存番号を受け取っていた旧版とは違う）。
  応答は {"ok":true,…} 形式。読み出しも含めて全て POST・同一オリジンからの fetch に限る。
  実処理は includes/scores.php（ログイン状態の判定は includes/account.php）。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_POST['lang'] ?? '';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';
require APP_ROOT . '/includes/account.php';
require APP_ROOT . '/includes/scores.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

function out(array $a): void {
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function err(string $code, ...$args): void {
  out(['ok' => false, 'error' => $code, 'message' => t('acc.err.' . $code, ...$args)]);
}

/* 入口チェック（CSRF よけ）。api/account.php と同じ条件にそろえてある */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')         { http_response_code(405); err('method'); }
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') { http_response_code(403); err('method'); }
$o = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($o !== '' && $origin !== '' && $o !== $origin)         { http_response_code(403); err('method'); }

$action = (string)($_POST['action'] ?? '');
$id     = (int)   ($_POST['id']     ?? 0);
$name   = (string)($_POST['name']   ?? '');
$notes  = (int)   ($_POST['notes']  ?? 0);
$data   = (string)($_POST['data']   ?? '');
$sig    = (string)($_POST['sig']    ?? '');
$sub    = (string)($_POST['sub']    ?? '');
/* src は「送られていない＝触らない」を区別するため null 許容で受ける */
$src    = array_key_exists('src', $_POST) ? (string)$_POST['src'] : null;
$fing   = (string)($_POST['fing']   ?? '');
/* 運指を出し入れする楽器。一覧に無い値は既定楽器として扱う（includes/scores.php の score_inst） */
$inst   = (string)($_POST['inst']   ?? '');

try {
  acc_session_start();
  /* セッションのトークンと突き合わせる（api/account.php の action=state で受け取ったもの） */
  if (!acc_csrf_ok((string)($_POST['csrf'] ?? ''))) { http_response_code(403); err('method'); }
  if (!acc_current())                               { http_response_code(401); err('needlogin'); }

  switch ($action) {

    case 'list': {
      $r = score_list();
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'items' => $r['items']]);
    }

    case 'save': {
      $r = score_save($name, $notes, $data, $sig, $fing, $id, $sub, $src, $inst);
      if (!$r['ok']) err($r['error'], SCORE_MAX_ITEMS);
      out(['ok' => true, 'id' => $r['id'], 'mode' => $r['mode']]);
    }

    case 'fing': {
      $r = score_fing($id, $fing, $inst);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'id' => $r['id']]);
    }

    case 'load': {
      $r = score_load($id, $inst);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'id' => $r['id'], 'name' => $r['name'], 'data' => $r['data'], 'fing' => $r['fing'], 'src' => $r['src']]);
    }

    case 'delete': {
      $r = score_delete($id);
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
