<?php
/*
  oauth/google.php — Google ログイン（OAuth 2.0 / Authorization Code）の往復。

    GET  ?lang=ja                … Google の同意画面へ送り出す（state をセッションに置く）
    GET  ?code=…&state=…&lang=ja … Google から戻ってきたところ。会員を作る／結びつけてログイン

  Google Cloud Console で「OAuth 2.0 クライアント ID（種類：ウェブ アプリケーション）」を作り、
  「承認済みのリダイレクト URI」に このファイルの URL を登録すること。
      例: https://genstrings.sakura.ne.jp/oauth/google.php
  発行された ID とシークレットは config/app.php の google_client_id / google_client_secret へ。
  どちらかが空のあいだは、この入口は何もせずアプリへ戻す（＝ボタンも出さない）。

  やっていること:
    1. state をセッションに置いて突き合わせる（＝他所から始められたログインを受けない）
    2. 受け取った code はサーバ側だけで access token に交換する（シークレットは画面に出さない）
    3. 誰なのかは Google の userinfo に問い合わせて確かめる
       （id_token を自前で検証すると署名鍵の取り回しが増えるので、サーバ間の問い合わせで済ませる）
    4. email_verified が true のときだけ受ける
  実処理（会員の作成・結びつけ）は includes/account.php の acc_oauth_google()。
*/
define('STRING_APP', 1);
define('APP_ROOT', dirname(__DIR__));

$LANG      = $_GET['lang'] ?? '';
$URL_DEPTH = 1;
require APP_ROOT . '/includes/bootstrap.php';
require APP_ROOT . '/includes/account.php';

const G_AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth';
const G_TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const G_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/* アプリへ戻る。$err にキーを渡すと、戻ったあとに画面へ知らせるための印を付ける */
function g_back(string $err = ''): void {
  global $LANG, $rootPath;
  $url = $rootPath . '/' . $LANG . '/' . APP_DEFAULT_INSTRUMENT . '/';
  if ($err !== '') $url .= '?login=' . rawurlencode($err);
  else             $url .= '?login=ok';
  header('Location: ' . $url, true, 302);
  exit;
}

/* このファイル自身の URL（リダイレクト URI）。Console に登録するものと一致させる */
function g_redirect_uri(): string {
  return acc_site_url() . $GLOBALS['rootPath'] . '/oauth/google.php';
}

/* POST で JSON を取ってくる。cURL が無い契約でも動くよう file_get_contents に落ちる */
function g_post(string $url, array $params): ?array {
  $body = http_build_query($params, '', '&', PHP_QUERY_RFC3986);
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_POST           => true,
      CURLOPT_POSTFIELDS     => $body,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT        => 15,
      CURLOPT_SSL_VERIFYPEER => true,
      CURLOPT_SSL_VERIFYHOST => 2,
      CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
    ]);
    $res = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($res === false) { error_log('[GEN strings google] token: ' . $err); return null; }
  } else {
    $res = @file_get_contents($url, false, stream_context_create([
      'http' => ['method' => 'POST', 'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
                 'content' => $body, 'timeout' => 15, 'ignore_errors' => true],
      'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
    ]));
    if ($res === false) { error_log('[GEN strings google] token: request failed'); return null; }
  }
  $j = json_decode((string)$res, true);
  return is_array($j) ? $j : null;
}

/* Bearer トークンを付けて GET する */
function g_get(string $url, string $token): ?array {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT        => 15,
      CURLOPT_SSL_VERIFYPEER => true,
      CURLOPT_SSL_VERIFYHOST => 2,
      CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $token],
    ]);
    $res = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($res === false) { error_log('[GEN strings google] userinfo: ' . $err); return null; }
  } else {
    $res = @file_get_contents($url, false, stream_context_create([
      'http' => ['method' => 'GET', 'header' => 'Authorization: Bearer ' . $token . "\r\n",
                 'timeout' => 15, 'ignore_errors' => true],
      'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
    ]));
    if ($res === false) { error_log('[GEN strings google] userinfo: request failed'); return null; }
  }
  $j = json_decode((string)$res, true);
  return is_array($j) ? $j : null;
}

try {
  /* 設定が入っていなければ何もしない（ボタンも出していないので、直接開かれた時だけここに来る） */
  if (APP_GOOGLE_ID === '' || APP_GOOGLE_SECRET === '') g_back('oauth');

  acc_session_start();

  $code  = (string)($_GET['code']  ?? '');
  $state = (string)($_GET['state'] ?? '');

  /* ---- 1. 戻ってきた場合 ---- */
  if ($code !== '' || $state !== '' || isset($_GET['error'])) {

    /* Google 側で断られた（同意しなかった等）。エラーの中身は画面に出さない */
    if (isset($_GET['error'])) { unset($_SESSION['g_state']); g_back('oauth_cancel'); }

    $want = (string)($_SESSION['g_state'] ?? '');
    unset($_SESSION['g_state']);          /* state は1回きり */
    if ($want === '' || $state === '' || !hash_equals($want, $state)) g_back('oauth');
    if ($code === '') g_back('oauth');

    /* code → access token。ここはサーバ間の通信なのでシークレットを載せてよい */
    $tok = g_post(G_TOKEN_URL, [
      'code'          => $code,
      'client_id'     => APP_GOOGLE_ID,
      'client_secret' => APP_GOOGLE_SECRET,
      'redirect_uri'  => g_redirect_uri(),
      'grant_type'    => 'authorization_code',
    ]);
    if (!$tok || empty($tok['access_token'])) g_back('oauth');

    /* 誰なのかを Google に聞く */
    $me = g_get(G_USERINFO_URL, (string)$tok['access_token']);
    if (!$me || empty($me['sub'])) g_back('oauth');

    $verified = !empty($me['email_verified']) && $me['email_verified'] !== 'false';
    $r = acc_oauth_google((string)$me['sub'], (string)($me['email'] ?? ''), $verified);
    if (!$r['ok']) g_back($r['error']);
    g_back();
  }

  /* ---- 2. 送り出す場合 ---- */
  $state = bin2hex(random_bytes(16));
  $_SESSION['g_state'] = $state;

  $q = http_build_query([
    'client_id'     => APP_GOOGLE_ID,
    'redirect_uri'  => g_redirect_uri(),
    'response_type' => 'code',
    'scope'         => 'openid email',
    'state'         => $state,
    /* 毎回どのアカウントで入るか選ばせる（家族で1台を使うことがあるため） */
    'prompt'        => 'select_account',
    'hl'            => $LANG,
  ], '', '&', PHP_QUERY_RFC3986);

  header('Cache-Control: no-store');
  header('Location: ' . G_AUTH_URL . '?' . $q, true, 302);
  exit;

} catch (Throwable $ex) {
  error_log('[GEN strings google] ' . $ex->getMessage());
  g_back('server');
}
