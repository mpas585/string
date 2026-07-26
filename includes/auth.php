<?php
/*
  includes/auth.php — 簡易会員（ニックネーム＋暗証番号4桁）の土台。

  ・保存先は SQLite 1ファイル（config/app.php の 'db_path'）。無ければ初回アクセス時に作る。
  ・暗証番号は password_hash で保存する（平文では持たない）。
  ・4桁は総当たりが容易なので、失敗回数でロックをかける（LOCK_AFTER 回で LOCK_SEC 秒）。
  ・セッションの実体も data/ の中に置く（共用サーバの共有 tmp に置くと他所の掃除で消える）。

  この段階では「登録・ログイン・ログアウト・自分の情報」だけ。
  会員向けの機能（練習記録の保存など）を足すときは users.id を外部キーにしたテーブルを増やす。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

const AUTH_LOCK_AFTER = 5;      /* 連続失敗の許容回数 */
const AUTH_LOCK_SEC   = 300;    /* ロックする秒数（5分） */
const AUTH_SESSION_SEC = 2592000; /* ログイン維持期間（30日） */

function auth_db(): PDO {
  static $pdo = null;
  if ($pdo instanceof PDO) return $pdo;

  $path = APP_DB_PATH;
  $dir  = dirname($path);
  if (!is_dir($dir)) { @mkdir($dir, 0700, true); }

  $pdo = new PDO('sqlite:' . $path, null, null, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  $pdo->exec('PRAGMA journal_mode = WAL');
  $pdo->exec('PRAGMA busy_timeout = 3000');
  $pdo->exec(
    'CREATE TABLE IF NOT EXISTS users (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       nick          TEXT    NOT NULL,
       nick_key      TEXT    NOT NULL UNIQUE,
       pin_hash      TEXT    NOT NULL,
       created_at    INTEGER NOT NULL,
       last_login_at INTEGER,
       fail_count    INTEGER NOT NULL DEFAULT 0,
       locked_until  INTEGER NOT NULL DEFAULT 0
     )'
  );
  @chmod($path, 0600);
  return $pdo;
}

/* セッション。Cookie は HttpOnly / SameSite=Lax、https のときだけ Secure */
function auth_session_start(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;

  $dir = APP_ROOT . '/data/sessions';
  if (!is_dir($dir)) { @mkdir($dir, 0700, true); }
  if (is_dir($dir) && is_writable($dir)) { session_save_path($dir); }

  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

  ini_set('session.gc_maxlifetime', (string)AUTH_SESSION_SEC);
  ini_set('session.use_strict_mode', '1');
  session_name('gsid');
  session_set_cookie_params([
    'lifetime' => AUTH_SESSION_SEC,
    'path'     => '/',
    'secure'   => $https,
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
  session_start();
}

/* ===== 入力の検証 ===== */
function auth_norm_nick(string $nick): string {
  $nick = trim(preg_replace('/[\x00-\x1f\x7f]/u', '', $nick));
  return preg_replace('/\s+/u', ' ', $nick);
}
function auth_nick_ok(string $nick): bool {
  $len = mb_strlen($nick, 'UTF-8');
  return $len >= 1 && $len <= 20;
}
function auth_pin_ok(string $pin): bool {
  return (bool)preg_match('/\A[0-9]{4}\z/', $pin);
}

/* ===== 会員操作 =====
   戻り値は ['ok'=>bool, 'error'=>string, 'user'=>array|null]。
   error は文言キー（includes/lang/*.php の account.err.* ）に対応させている。 */
function auth_register(string $nick, string $pin): array {
  $nick = auth_norm_nick($nick);
  if (!auth_nick_ok($nick)) return ['ok' => false, 'error' => 'nick'];
  if (!auth_pin_ok($pin))   return ['ok' => false, 'error' => 'pin'];

  $db  = auth_db();
  $key = mb_strtolower($nick, 'UTF-8');
  $st  = $db->prepare('SELECT id FROM users WHERE nick_key = ?');
  $st->execute([$key]);
  if ($st->fetch()) return ['ok' => false, 'error' => 'taken'];

  $st = $db->prepare('INSERT INTO users (nick, nick_key, pin_hash, created_at, last_login_at) VALUES (?,?,?,?,?)');
  $now = time();
  $st->execute([$nick, $key, password_hash($pin, PASSWORD_DEFAULT), $now, $now]);

  $user = ['id' => (int)$db->lastInsertId(), 'nick' => $nick];
  auth_set_login($user);
  return ['ok' => true, 'user' => $user];
}

function auth_login(string $nick, string $pin): array {
  $nick = auth_norm_nick($nick);
  if ($nick === '' || $pin === '') return ['ok' => false, 'error' => 'empty'];

  $db = auth_db();
  $st = $db->prepare('SELECT * FROM users WHERE nick_key = ?');
  $st->execute([mb_strtolower($nick, 'UTF-8')]);
  $u = $st->fetch();

  /* 存在しないニックネームでも同じ応答にする（総当たりで実在を探られないように） */
  if (!$u) return ['ok' => false, 'error' => 'nomatch'];

  $now = time();
  if ((int)$u['locked_until'] > $now) {
    return ['ok' => false, 'error' => 'locked', 'wait' => (int)ceil(((int)$u['locked_until'] - $now) / 60)];
  }

  if (!password_verify($pin, $u['pin_hash'])) {
    $fail = (int)$u['fail_count'] + 1;
    $lock = ($fail >= AUTH_LOCK_AFTER) ? ($now + AUTH_LOCK_SEC) : 0;
    $db->prepare('UPDATE users SET fail_count = ?, locked_until = ? WHERE id = ?')
       ->execute([$lock ? 0 : $fail, $lock, $u['id']]);
    if ($lock) return ['ok' => false, 'error' => 'locked', 'wait' => (int)ceil(AUTH_LOCK_SEC / 60)];
    return ['ok' => false, 'error' => 'nomatch', 'left' => AUTH_LOCK_AFTER - $fail];
  }

  $db->prepare('UPDATE users SET fail_count = 0, locked_until = 0, last_login_at = ? WHERE id = ?')
     ->execute([$now, $u['id']]);

  $user = ['id' => (int)$u['id'], 'nick' => $u['nick']];
  auth_set_login($user);
  return ['ok' => true, 'user' => $user];
}

function auth_set_login(array $user): void {
  auth_session_start();
  session_regenerate_id(true);       /* セッション固定攻撃よけ */
  $_SESSION['uid']  = $user['id'];
  $_SESSION['nick'] = $user['nick'];
}

function auth_logout(): void {
  auth_session_start();
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $p = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
  }
  session_destroy();
}

/* ログイン中なら ['id'=>, 'nick'=>]、していなければ null */
function auth_current(): ?array {
  auth_session_start();
  if (empty($_SESSION['uid'])) return null;
  return ['id' => (int)$_SESSION['uid'], 'nick' => (string)($_SESSION['nick'] ?? '')];
}
