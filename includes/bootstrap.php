<?php
/*
  includes/bootstrap.php — 言語まわりの共通処理（トップと楽器ページの両方で使う）。

  呼び出し側で $LANG と $URL_DEPTH を定義しておくこと:
      $LANG = 'ja'; $URL_DEPTH = 1;   → /{言語}/
      $LANG = 'ja'; $URL_DEPTH = 2;   → /{言語}/{楽器}/

  ここでやること:
    1. config/app.php の読み込み（APP_* 定数）
    2. 言語のホワイトリスト検証・辞書の読み込み・未翻訳キーの ja フォールバック
    3. テンプレート用ヘルパ h() / t() / e() / er()
    4. パス（$BASE / $rootPath / $origin / $LANG_HOME_URLS）の算出

  ※ 楽器の読み込み（config/{楽器}.php）は includes/string_instrument.php 側でやる。
*/

if (!defined('STRING_APP')) { define('STRING_APP', 1); }
if (!defined('APP_ROOT'))   { define('APP_ROOT', dirname(__DIR__)); }

$URL_DEPTH = isset($URL_DEPTH) ? (int)$URL_DEPTH : 2;

/* ===== 1. config/app.php（対応言語・対応楽器の唯一の定義） ===== */
$APP_CFG = require APP_ROOT . '/config/app.php';
if (!defined('APP_NAME')) {
  define('APP_NAME',               $APP_CFG['name']);
  define('APP_LANGS',              $APP_CFG['langs']);
  define('APP_INSTRUMENTS',        $APP_CFG['instruments']);
  define('APP_DEFAULT_LANG',       $APP_CFG['default_lang']);
  define('APP_DEFAULT_INSTRUMENT', $APP_CFG['default_instrument']);
  define('APP_CONTACT_TO',         $APP_CFG['contact_to']);
  /* 管理者（マスターアカウント）。共有曲の管理メニューを出す判定に使う。
     突き合わせは小文字にそろえてから行う（users.email は小文字で持っている） */
  define('APP_ADMIN_EMAIL',        strtolower(trim((string)($APP_CFG['admin_email'] ?? ''))));
  define('APP_GA_ID',              $APP_CFG['ga_id'] ?? '');
  define('APP_DB_PATH',            $APP_CFG['db_path']);
  /* アカウント（includes/account.php / api/account.php / oauth/google.php で使う） */
  define('APP_SITE_URL',           rtrim((string)($APP_CFG['site_url'] ?? ''), '/'));
  define('APP_MAIL_FROM',          (string)($APP_CFG['mail_from'] ?? ''));
  define('APP_MAIL_FROM_NAME',     (string)($APP_CFG['mail_from_name'] ?? APP_NAME));
  define('APP_GOOGLE_ID',          (string)($APP_CFG['google_client_id'] ?? ''));
  define('APP_GOOGLE_SECRET',      (string)($APP_CFG['google_client_secret'] ?? ''));
}

/* ===== 2. 言語（require のパスに直接使うためホワイトリスト必須） ===== */
$LANG = (isset($LANG) && in_array($LANG, APP_LANGS, true)) ? $LANG : APP_DEFAULT_LANG;
$T    = require APP_ROOT . '/includes/lang/' . $LANG . '.php';

/* 部分翻訳のフォールバック：未翻訳のキーは既定言語（ja）の文言で埋める */
if ($LANG !== APP_DEFAULT_LANG) {
  $T = array_replace_recursive(require APP_ROOT . '/includes/lang/' . APP_DEFAULT_LANG . '.php', $T);
}

/* ===== 3. テンプレート用ヘルパ ===== */
if (!function_exists('h')) {
  function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
}
if (!function_exists('t')) {
  /* 'ui.menu' のようにドットで引く。可変引数を渡すと vsprintf する */
  function t(string $key, ...$args) {
    $v = $GLOBALS['T'];
    foreach (explode('.', $key) as $k) {
      if (!is_array($v) || !array_key_exists($k, $v)) return $key;
      $v = $v[$k];
    }
    if (!is_string($v)) return $v;
    return $args ? vsprintf($v, $args) : $v;
  }
}
if (!function_exists('e')) {
  function e(string $key, ...$args): void { echo h(t($key, ...$args)); }
}
if (!function_exists('er')) {
  /* HTML を含む文言（キー末尾が _html のもの）専用。エスケープしない */
  function er(string $key, ...$args): void { echo t($key, ...$args); }
}

/* ===== 3.5 読み込み先の制限（Content-Security-Policy） =====
   JS・CSS・画像・通信先を「このサーバの中」に限る。素の 'self' だけにすると
   いま使っている次の3つが止まるので、そこだけを名指しで許可している。
     cdnjs.cloudflare.com   … JSZip（.mxl の解凍）と pdf.js（PDF表示・そのworker）
     googletagmanager.com   … GA4 の計測タグ（includes/views/analytics.php）
     google-analytics.com   … GA4 の送信先
   'unsafe-inline' が要るのは、ビューに直書きしている <script>window.APP=…</script> と
   style="" 属性のため。これらを外部ファイルへ出すまでは外せない。

   ※ HTML を返すページ（includes/home.php / includes/string_instrument.php）からだけ呼ぶ。
      api/*.php は JSON なので送らない。
   ※ 許可先を増やすときはここ1か所と sw.js の素通し設定を合わせて直すこと。 */
if (!function_exists('app_send_csp')) {
  function app_send_csp(): void {
    if (headers_sent()) { return; }
    $csp = implode('; ', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://www.googletagmanager.com",
      "worker-src 'self' blob: https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com",
      "font-src 'self' data:",
      "media-src 'self' blob:",
      "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      /* Google ログイン：accounts.google.com へ遷移する（送信先ではなく location 遷移だが、
         ブラウザによっては form-action で見られるため両方に入れてある）。
         config/app.php の google_client_id が空でも、許可を出すだけなら害はない。 */
      "form-action 'self' https://accounts.google.com",
      "frame-ancestors 'self'",
    ]);
    header('Content-Security-Policy: ' . $csp);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
  }
}

/* ===== 4. パス ===== */
$BASE      = str_repeat('../', $URL_DEPTH);              /* 今のページからルートまで */
$scriptDir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
/* 設置ディレクトリ（直下なら ''）。
   ルートの index.php から呼ばれたときは $URL_DEPTH が 0 で、そのときは遡らずに
   $scriptDir がそのまま設置ディレクトリになる。
   PHP 8 の dirname() は第2引数に 0 を渡すと ValueError を投げるので、先に分ける。 */
$rootPath  = rtrim($URL_DEPTH > 0 ? dirname($scriptDir, $URL_DEPTH) : $scriptDir, '/');

$https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
       || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$host   = $_SERVER['HTTP_HOST'] ?? '';
$origin = $host ? (($https ? 'https' : 'http') . '://' . $host) : '';

/* 言語別トップ（楽器選択）のURL。hreflang と言語セレクトで使う */
$LANG_HOME_URLS = [];
foreach (APP_LANGS as $l) { $LANG_HOME_URLS[$l] = $rootPath . '/' . $l . '/'; }
