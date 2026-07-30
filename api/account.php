<?php
/*
  api/account.php — アカウント（メールアドレス＋パスワード）の入口。

  【1】JSON API（POST。同一オリジンからの fetch のみ）
    action=state                             … いまのログイン状態と CSRF トークン
    action=signup   email= pass=             … 新規登録（確認メールを送る）
    action=resend   email=                   … 確認メールの再送
    action=login    email= pass=             … ログイン
    action=logout                            … ログアウト
    action=forgot   email=                   … パスワード再発行メールを送る
    action=passwd   now= next=               … ログイン中にパスワードを変える
    action=pull                              … 預けてある設定を取り出す
    action=push     payload=                 … 設定を預ける（上書き）
    action=destroy                           … 退会（譜面も消す）

  【2】メールのリンク（GET。ブラウザで直接開く）
    ?do=verify&t=…&lang=ja                   … メール確認 → 済んだらアプリへ戻す
    ?do=reset&t=…&lang=ja                    … パスワード再設定の画面を出す
    POST do=reset t= pass=                   … 新しいパスワードを確定する

  応答は {"ok":true,…} / {"ok":false,"error":"…","message":"…"} 形式。
  メールアドレスもパスワードも URL には出さない（履歴・アクセスログ・Referer に残さないため）＝全て POST。
  実処理は includes/account.php。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_POST['lang'] ?? $_GET['lang'] ?? '';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';
require APP_ROOT . '/includes/account.php';

function out(array $a): void {
  header('Content-Type: application/json; charset=UTF-8');
  header('Cache-Control: no-store');
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function err(string $code, ...$args): void {
  out(['ok' => false, 'error' => $code, 'message' => t('acc.err.' . $code, ...$args)]);
}

/* ===================== 【2】メールのリンク（GET / POST do=…） ===================== */
$do = (string)($_GET['do'] ?? $_POST['do'] ?? '');
if ($do !== '') {
  /* 素朴な1枚ページを返す。アプリ本体の見た目は使わない（読み込むものを増やさないため） */
  function acc_page(string $title, string $bodyHtml): void {
    global $LANG;
    app_send_csp();
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store');
    echo '<!doctype html><html lang="' . h($LANG) . '"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1">'
       . '<title>' . h($title) . ' | ' . h(APP_NAME) . '</title>'
       . '<style>'
       . 'body{margin:0;background:#15110c;color:#efe6d8;font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;'
       . 'display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}'
       . '.card{width:100%;max-width:380px;background:#1e1811;border:1px solid #3a2f20;border-radius:14px;padding:22px}'
       . 'h1{font-size:17px;margin:0 0 14px}p{font-size:13px;line-height:1.8;color:#c8bba6;margin:0 0 14px}'
       . 'label{display:block;font-size:12px;color:#c8bba6;margin:0 0 6px}'
       . 'input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #3a2f20;'
       . 'background:#15110c;color:#efe6d8;font-size:16px;margin:0 0 12px}'
       . 'button,a.btn{display:block;width:100%;box-sizing:border-box;text-align:center;text-decoration:none;'
       . 'padding:12px;border-radius:9px;border:none;background:#e0a83c;color:#241a08;font-size:14px;font-weight:700;cursor:pointer}'
       . '.err{color:#f0907f;font-size:12px;margin:0 0 12px}'
       . '</style></head><body><div class="card"><h1>' . h($title) . '</h1>' . $bodyHtml . '</div></body></html>';
    exit;
  }
  /* 確認・再設定が済んだあとの戻り先。楽器ページの既定に戻す */
  function acc_app_url(): string {
    global $LANG, $rootPath;
    return $rootPath . '/' . $LANG . '/' . APP_DEFAULT_INSTRUMENT . '/';
  }

  try {
    /* ---- メール確認 ---- */
    if ($do === 'verify') {
      $r = acc_verify((string)($_GET['t'] ?? ''));
      if (!$r['ok']) {
        acc_page(t('acc.page.verify_ng_title'),
          '<p>' . h(t('acc.page.verify_ng_body')) . '</p>'
          . '<a class="btn" href="' . h(acc_app_url()) . '">' . h(t('acc.page.to_app')) . '</a>');
      }
      acc_page(t('acc.page.verify_ok_title'),
        '<p>' . h(t('acc.page.verify_ok_body')) . '</p>'
        . '<a class="btn" href="' . h(acc_app_url()) . '">' . h(t('acc.page.to_app')) . '</a>');
    }

    /* ---- パスワード再設定 ---- */
    if ($do === 'reset') {
      $tok = (string)($_POST['t'] ?? $_GET['t'] ?? '');

      if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $r = acc_reset($tok, (string)($_POST['pass'] ?? ''));
        if (!$r['ok']) {
          $msg = t('acc.err.' . $r['error']);
          acc_page(t('acc.page.reset_title'),
            '<p class="err">' . h($msg) . '</p>'
            . '<form method="post" action="">'
            . '<input type="hidden" name="do" value="reset">'
            . '<input type="hidden" name="t" value="' . h($tok) . '">'
            . '<input type="hidden" name="lang" value="' . h($LANG) . '">'
            . '<label for="p">' . h(t('acc.page.reset_label')) . '</label>'
            . '<input id="p" name="pass" type="password" minlength="' . ACC_PASS_MIN . '" autocomplete="new-password" required>'
            . '<button type="submit">' . h(t('acc.page.reset_submit')) . '</button>'
            . '</form>');
        }
        acc_page(t('acc.page.reset_ok_title'),
          '<p>' . h(t('acc.page.reset_ok_body')) . '</p>'
          . '<a class="btn" href="' . h(acc_app_url()) . '">' . h(t('acc.page.to_app')) . '</a>');
      }

      acc_page(t('acc.page.reset_title'),
        '<p>' . h(t('acc.page.reset_body', ACC_PASS_MIN)) . '</p>'
        . '<form method="post" action="">'
        . '<input type="hidden" name="do" value="reset">'
        . '<input type="hidden" name="t" value="' . h($tok) . '">'
        . '<input type="hidden" name="lang" value="' . h($LANG) . '">'
        . '<label for="p">' . h(t('acc.page.reset_label')) . '</label>'
        . '<input id="p" name="pass" type="password" minlength="' . ACC_PASS_MIN . '" autocomplete="new-password" required>'
        . '<button type="submit">' . h(t('acc.page.reset_submit')) . '</button>'
        . '</form>');
    }

    http_response_code(400);
    acc_page(t('acc.page.verify_ng_title'), '<p>' . h(t('acc.err.token')) . '</p>');

  } catch (Throwable $ex) {
    error_log('[GEN strings account] ' . $ex->getMessage());
    http_response_code(500);
    acc_page(t('acc.page.verify_ng_title'), '<p>' . h(t('acc.err.server')) . '</p>');
  }
}

/* ===================== 【1】JSON API ===================== */
/* 入口チェック（CSRF よけ）。読み出しも含めて全て POST なので例外は作らない。
   X-Requested-With は素のフォーム送信では付けられない＝他所のページからは叩けない。 */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')         { http_response_code(405); err('method'); }
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') { http_response_code(403); err('method'); }
$o = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($o !== '' && $origin !== '' && $o !== $origin)         { http_response_code(403); err('method'); }

$action  = (string)($_POST['action']  ?? '');
$email   = (string)($_POST['email']   ?? '');
$pass    = (string)($_POST['pass']    ?? '');
$payload = (string)($_POST['payload'] ?? '');
$csrf    = (string)($_POST['csrf']    ?? '');

try {
  acc_session_start();

  /* 状態の問い合わせだけは CSRF トークン無しで通す（これを取りに来るのが最初の1回目のため） */
  if ($action === 'state') {
    $u = acc_current();
    out(['ok' => true, 'user' => acc_public($u), 'csrf' => acc_csrf(),
         'google' => (APP_GOOGLE_ID !== '' && APP_GOOGLE_SECRET !== '')]);
  }

  /* ここから先は状態が変わる操作。セッションのトークンと突き合わせる */
  if (!acc_csrf_ok($csrf)) { http_response_code(403); err('method'); }

  switch ($action) {

    case 'signup': {
      $r = acc_signup($email, $pass, $LANG);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'sent' => true, 'message' => t('acc.ok.signup')]);
    }

    case 'resend': {
      $r = acc_resend($email, $LANG);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'sent' => true, 'message' => t('acc.ok.resend')]);
    }

    case 'login': {
      $r = acc_login($email, $pass);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'user' => acc_public($r['user']), 'csrf' => acc_csrf(),
           'payload' => acc_payload_get($r['user']), 'message' => t('acc.ok.login')]);
    }

    case 'logout': {
      acc_logout();
      acc_session_start();
      out(['ok' => true, 'csrf' => acc_csrf(), 'message' => t('acc.ok.logout')]);
    }

    case 'forgot': {
      $r = acc_forgot($email, $LANG);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'sent' => true, 'message' => t('acc.ok.forgot')]);
    }

    case 'passwd': {
      $u = acc_current();
      if (!$u) { http_response_code(401); err('needlogin'); }
      $r = acc_change_pass($u, (string)($_POST['now'] ?? ''), (string)($_POST['next'] ?? ''));
      if (!$r['ok']) err($r['error']);
      out(['ok' => true, 'message' => t('acc.ok.passwd')]);
    }

    case 'pull': {
      $u = acc_current();
      if (!$u) { http_response_code(401); err('needlogin'); }
      out(['ok' => true, 'payload' => acc_payload_get($u)]);
    }

    case 'push': {
      $u = acc_current();
      if (!$u) { http_response_code(401); err('needlogin'); }
      $r = acc_payload_put($u, $payload);
      if (!$r['ok']) err($r['error']);
      out(['ok' => true]);
    }

    case 'destroy': {
      $u = acc_current();
      if (!$u) { http_response_code(401); err('needlogin'); }
      /* 退会はパスワードをもう一度確かめる（Google だけの人は確かめようがないので省く） */
      if ($u['pass_hash'] !== '' && !password_verify($pass, $u['pass_hash'])) {
        acc_fail($u['email']);
        err('signin');
      }
      acc_delete($u);
      acc_session_start();
      out(['ok' => true, 'csrf' => acc_csrf(), 'message' => t('acc.ok.destroy')]);
    }
  }
  http_response_code(400);
  err('method');

} catch (Throwable $ex) {
  /* 例外の中身は返さない（DBパス等が漏れるため）。詳細はサーバのエラーログで見る */
  error_log('[GEN strings account] ' . $ex->getMessage());
  http_response_code(500);
  err('server');
}
