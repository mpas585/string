<?php
/*
  includes/account.php — メールアドレス＋パスワードのアカウントの土台。

  旧「保存番号（英字1文字＋数字4桁）」は廃止した。includes/auth.php と api/auth.php は
  削除してある。既存の saves テーブルは参照しない（引き継ぎもしない）。
  消したいときは手で DROP TABLE saves / save_hits すること
  （自動で消さないのは、切り戻しの余地を残すため）。

  ここでやること:
    1. SQLite の用意（users / user_tokens / user_oauth / auth_hits）
    2. セッション（ログイン状態）とCSRFトークン
    3. 登録・確認メール・ログイン・ログアウト・パスワード再発行・退会
    4. Google ログインで使う「メールで人を引き当てる／作る」処理
    5. 設定（旧 saves.payload）の読み書き

  方針:
    ・パスワードは password_hash() のまま持つ（平文もハッシュ元も残さない）
    ・メール確認が済むまでログインさせない（config の方針どおり）
    ・「そのメールは登録済みです」を返さない＝アドレスの存在を外から数えられないようにする
    ・ログイン失敗・再発行の要求は IP とメールの両方で回数を数え、続いたら一定時間断る
    ・トークン（確認・再発行）はハッシュにして持つ。DBを見ても本物は作れない
    ・パスワードを変えた／再発行したら、そのアカウントの他のセッションは全部切る
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

const ACC_SESSION_NAME  = 'gsid';
const ACC_PASS_MIN      = 8;        /* パスワードの最短の長さ */
const ACC_PASS_MAX      = 200;      /* 長すぎるものは受け取らない（ハッシュ計算での詰まり防止） */
const ACC_EMAIL_MAX     = 254;      /* RFC 上の上限 */
const ACC_MAX_BYTES     = 512000;   /* 預かる設定 JSON の上限（約500KB） */
const ACC_VERIFY_HOURS  = 24;       /* 確認メールのリンクが有効な時間 */
const ACC_RESET_MIN     = 60;       /* 再発行メールのリンクが有効な時間（分） */
const ACC_RATE_SEC      = 900;      /* 回数を数える窓（15分） */
const ACC_RATE_IP       = 30;       /* 窓の中で同じ IP に許す失敗の回数 */
const ACC_RATE_ID       = 8;        /* 窓の中で同じメールに許す失敗の回数 */
const ACC_SEND_SEC      = 3600;     /* 確認・再発行メールの送信間隔を見る窓（1時間） */
const ACC_SEND_MAX      = 5;        /* その窓で同じメールに送る上限 */

/* ===== 1. DB ===== */

/* 昔の users テーブル（ニックネーム＋暗証番号のころのもの）を退避する。
   消さずに users_legacy へ改名するだけにしてある。中身を見たくなったときのため。
   要らなくなったら手で DROP TABLE users_legacy; してよい。
   今の形（email 列がある）なら何もしない。 */
function acc_migrate_users(PDO $pdo): void {
  $cols = [];
  foreach ($pdo->query('PRAGMA table_info(users)') as $c) $cols[] = $c['name'];
  if (!$cols) return;                              /* まだ無い＝このあと作られる */
  if (in_array('email', $cols, true)) return;      /* 今の形。触らない */

  /* 退避先の名前が埋まっていたら連番を足す */
  $name = 'users_legacy';
  $n = 1;
  while ($pdo->query('SELECT 1 FROM sqlite_master WHERE type = ' . "'table'" . ' AND name = ' . $pdo->quote($name))->fetchColumn()) {
    $name = 'users_legacy_' . (++$n);
  }
  $pdo->exec('ALTER TABLE users RENAME TO ' . $name);
  error_log('[GEN strings account] 旧 users テーブルを ' . $name . ' へ退避し、新しい users を作りました');
}

function acc_db(): PDO {
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

  /* 昔の users テーブルが残っていたら、先に退避しておく。
     CREATE TABLE IF NOT EXISTS は「名前が同じなら中身が違っても何もしない」ので、
     列の違う古い users が居座っていると、後の SELECT が
     「no such column: email」で落ちる（実際にこれで登録・ログインが 500 になった）。 */
  acc_migrate_users($pdo);

  /* 会員本体。
     email    … 小文字に寄せたもの（引き当てはこれで行う）
     pass_hash… Google だけで入っている人は空文字（＝パスワードでは入れない）
     status   … 'pending'（確認待ち） / 'active'（確認済み）
     payload  … 画面の設定。旧 saves.payload と同じ中身
     data_key … 譜面（scores）を紐づける内部キー。画面には出さない */
  $pdo->exec(
    'CREATE TABLE IF NOT EXISTS users (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       email         TEXT    NOT NULL UNIQUE,
       pass_hash     TEXT    NOT NULL DEFAULT ' . "''" . ',
       status        TEXT    NOT NULL DEFAULT ' . "'pending'" . ',
       payload       TEXT    NOT NULL DEFAULT ' . "'{}'" . ',
       data_key      TEXT    NOT NULL UNIQUE,
       sess_epoch    INTEGER NOT NULL DEFAULT 1,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       last_login_at INTEGER NOT NULL DEFAULT 0
     )'
  );
  /* メール確認・パスワード再発行のトークン。token は生値を持たずハッシュで持つ */
  $pdo->exec(
    'CREATE TABLE IF NOT EXISTS user_tokens (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id    INTEGER NOT NULL,
       kind       TEXT    NOT NULL,
       token_hash TEXT    NOT NULL UNIQUE,
       expires_at INTEGER NOT NULL,
       used_at    INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )'
  );
  $pdo->exec('CREATE INDEX IF NOT EXISTS ix_user_tokens ON user_tokens (user_id, kind)');
  /* 外部ログイン（いまは Google だけ）。sub は Google 側の変わらない利用者ID */
  $pdo->exec(
    'CREATE TABLE IF NOT EXISTS user_oauth (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       provider   TEXT    NOT NULL,
       sub        TEXT    NOT NULL,
       user_id    INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       UNIQUE (provider, sub)
     )'
  );
  $pdo->exec('CREATE INDEX IF NOT EXISTS ix_user_oauth_uid ON user_oauth (user_id)');
  /* 失敗の記録（総当たり対策）。成功したリクエストは残さない。
     who は IP か「メールの指紋」。メールそのものはここに書かない */
  $pdo->exec(
    'CREATE TABLE IF NOT EXISTS auth_hits (
       who  TEXT    NOT NULL,
       kind TEXT    NOT NULL,
       ts   INTEGER NOT NULL
     )'
  );
  $pdo->exec('CREATE INDEX IF NOT EXISTS ix_auth_hits ON auth_hits (who, kind, ts)');
  @chmod($path, 0600);
  return $pdo;
}

/* ===== 2. 入力の検証 ===== */
function acc_norm_email(string $email): string {
  $e = trim($email);
  /* 全角で入力されることがあるので半角へ寄せる。@ とドットだけで足りる */
  $e = strtr($e, ['＠' => '@', '．' => '.', '　' => '']);
  return strtolower($e);
}
function acc_email_ok(string $email): bool {
  if ($email === '' || strlen($email) > ACC_EMAIL_MAX) return false;
  if (!filter_var($email, FILTER_VALIDATE_EMAIL))       return false;
  /* ヘッダ差し込みよけ。改行を含むものは入口で落とす */
  return !preg_match('/[\r\n]/', $email);
}
function acc_pass_ok(string $pass): bool {
  $n = strlen($pass);
  if ($n < ACC_PASS_MIN || $n > ACC_PASS_MAX) return false;
  /* 同じ文字だけ・連番だけを弾く。辞書は持たない（当てにならないうえ保守が重い） */
  if (preg_match('/\A(.)\1*\z/u', $pass)) return false;
  return true;
}

/* ===== 3. レート制限 ===== */
function acc_ip(): string { return (string)($_SERVER['REMOTE_ADDR'] ?? '-'); }
/* メールをそのまま記録に残さないための指紋。DBが漏れてもアドレスは復元できない */
function acc_fp(string $email): string { return 'e:' . substr(hash('sha256', $email), 0, 24); }

function acc_hit(string $who, string $kind): void {
  acc_db()->prepare('INSERT INTO auth_hits (who, kind, ts) VALUES (?,?,?)')
          ->execute([$who, $kind, time()]);
}
function acc_count(string $who, string $kind, int $window): int {
  $db  = acc_db();
  $now = time();
  /* 窓から出た記録は毎回まとめて捨てる（別途の掃除を要らなくするため） */
  $db->prepare('DELETE FROM auth_hits WHERE ts < ?')->execute([$now - max($window, ACC_RATE_SEC)]);
  $st = $db->prepare('SELECT COUNT(*) FROM auth_hits WHERE who = ? AND kind = ? AND ts >= ?');
  $st->execute([$who, $kind, $now - $window]);
  return (int)$st->fetchColumn();
}
/* ログイン・再発行の試行が続いていないか。true なら断る */
function acc_blocked(string $email = ''): bool {
  if (acc_count(acc_ip(), 'fail', ACC_RATE_SEC) >= ACC_RATE_IP) return true;
  if ($email !== '' && acc_count(acc_fp($email), 'fail', ACC_RATE_SEC) >= ACC_RATE_ID) return true;
  return false;
}
function acc_fail(string $email = ''): void {
  acc_hit(acc_ip(), 'fail');
  if ($email !== '') acc_hit(acc_fp($email), 'fail');
}
/* メールの送りすぎを止める（確認・再発行の連打よけ） */
function acc_send_blocked(string $email): bool {
  return acc_count(acc_fp($email), 'send', ACC_SEND_SEC) >= ACC_SEND_MAX;
}
function acc_send_hit(string $email): void { acc_hit(acc_fp($email), 'send'); }

/* ===== 4. セッション ===== */
function acc_session_start(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  session_name(ACC_SESSION_NAME);
  @session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => $https,
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
  @session_start();
}
/* ログイン中の利用者。無ければ null。
   sess_epoch はパスワード変更・退会で増やす＝古い端末のセッションはここで無効になる */
function acc_current(): ?array {
  static $cache = false;
  if ($cache !== false) return $cache;
  acc_session_start();
  $uid = (int)($_SESSION['uid'] ?? 0);
  $ep  = (int)($_SESSION['ep']  ?? 0);
  if ($uid <= 0) { $cache = null; return null; }
  $st = acc_db()->prepare('SELECT * FROM users WHERE id = ?');
  $st->execute([$uid]);
  $u = $st->fetch();
  if (!$u || $u['status'] !== 'active' || (int)$u['sess_epoch'] !== $ep) {
    acc_logout();
    $cache = null; return null;
  }
  $cache = $u;
  return $u;
}
function acc_login_session(array $u): void {
  acc_session_start();
  session_regenerate_id(true);        /* 固定化よけ。ログインのたびにIDを振り直す */
  $_SESSION['uid'] = (int)$u['id'];
  $_SESSION['ep']  = (int)$u['sess_epoch'];
  $_SESSION['csrf'] = $_SESSION['csrf'] ?? bin2hex(random_bytes(16));
  acc_db()->prepare('UPDATE users SET last_login_at = ? WHERE id = ?')->execute([time(), (int)$u['id']]);
}
function acc_logout(): void {
  acc_session_start();
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $p = session_get_cookie_params();
    @setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
  }
  @session_destroy();
}
/* このアカウントの他の端末のセッションを切る（パスワード変更・再発行のとき） */
function acc_bump_epoch(int $uid): int {
  acc_db()->prepare('UPDATE users SET sess_epoch = sess_epoch + 1, updated_at = ? WHERE id = ?')
          ->execute([time(), $uid]);
  $st = acc_db()->prepare('SELECT sess_epoch FROM users WHERE id = ?');
  $st->execute([$uid]);
  return (int)$st->fetchColumn();
}

/* ===== 5. CSRF ===== */
function acc_csrf(): string {
  acc_session_start();
  if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
  return $_SESSION['csrf'];
}
function acc_csrf_ok(string $sent): bool {
  acc_session_start();
  $have = (string)($_SESSION['csrf'] ?? '');
  return $have !== '' && hash_equals($have, $sent);
}

/* ===== 6. トークン（確認・再発行） ===== */
function acc_token_new(int $uid, string $kind, int $ttlSec): string {
  $raw  = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
  $hash = hash('sha256', $kind . ':' . $raw);
  $now  = time();
  /* 同じ種類の未使用ぶんは先に片づける＝有効なリンクは常に最後の1本だけ */
  acc_db()->prepare('DELETE FROM user_tokens WHERE user_id = ? AND kind = ?')->execute([$uid, $kind]);
  acc_db()->prepare('INSERT INTO user_tokens (user_id, kind, token_hash, expires_at, used_at, created_at) VALUES (?,?,?,?,0,?)')
          ->execute([$uid, $kind, $hash, $now + $ttlSec, $now]);
  return $raw;
}
/* 使えるトークンなら user 行を返す。使ったぶんはその場で消す（1回きり） */
function acc_token_take(string $kind, string $raw): ?array {
  if ($raw === '' || strlen($raw) > 120) return null;
  $hash = hash('sha256', $kind . ':' . $raw);
  $db   = acc_db();
  $db->prepare('DELETE FROM user_tokens WHERE expires_at < ?')->execute([time()]);
  $st = $db->prepare('SELECT * FROM user_tokens WHERE token_hash = ? AND kind = ? AND used_at = 0');
  $st->execute([$hash, $kind]);
  $row = $st->fetch();
  if (!$row || (int)$row['expires_at'] < time()) return null;
  $db->prepare('DELETE FROM user_tokens WHERE id = ?')->execute([(int)$row['id']]);
  $st = $db->prepare('SELECT * FROM users WHERE id = ?');
  $st->execute([(int)$row['user_id']]);
  $u = $st->fetch();
  return $u ?: null;
}

/* ===== 7. メール送信（さくらの標準どおり mail()） ===== */
function acc_site_url(): string {
  if (APP_SITE_URL !== '') return APP_SITE_URL;
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  $host  = (string)($_SERVER['HTTP_HOST'] ?? '');
  if ($host === '' || preg_match('/[^A-Za-z0-9.\-:]/', $host)) return '';
  return ($https ? 'https://' : 'http://') . $host;
}
function acc_mail(string $to, string $subject, string $body): bool {
  if (!acc_email_ok($to) || APP_MAIL_FROM === '') return false;
  /* 日本語の件名・送信者名は MIME エンコードして渡す */
  $enc  = '=?UTF-8?B?' . base64_encode($subject) . '?=';
  $name = '=?UTF-8?B?' . base64_encode(APP_MAIL_FROM_NAME) . '?=';
  $head = implode("\r\n", [
    'From: ' . $name . ' <' . APP_MAIL_FROM . '>',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
  ]);
  $prev = ini_get('mail.add_x_header');
  $ok = @mail($to, $enc, $body, $head, '-f' . APP_MAIL_FROM);
  if (!$ok) error_log('[GEN strings account] mail() に失敗しました');
  return (bool)$ok;
}
function acc_send_verify(array $u, string $lang): void {
  $tok = acc_token_new((int)$u['id'], 'verify', ACC_VERIFY_HOURS * 3600);
  $url = acc_site_url() . '/api/account.php?do=verify&t=' . rawurlencode($tok) . '&lang=' . rawurlencode($lang);
  acc_mail($u['email'], t('acc.mail.verify_subject'), t('acc.mail.verify_body', $url, ACC_VERIFY_HOURS));
  acc_send_hit($u['email']);
}
function acc_send_reset(array $u, string $lang): void {
  $tok = acc_token_new((int)$u['id'], 'reset', ACC_RESET_MIN * 60);
  $url = acc_site_url() . '/api/account.php?do=reset&t=' . rawurlencode($tok) . '&lang=' . rawurlencode($lang);
  acc_mail($u['email'], t('acc.mail.reset_subject'), t('acc.mail.reset_body', $url, ACC_RESET_MIN));
  acc_send_hit($u['email']);
}

/* ===== 8. 利用者の作成・引き当て ===== */
function acc_find(string $email): ?array {
  $st = acc_db()->prepare('SELECT * FROM users WHERE email = ?');
  $st->execute([$email]);
  $u = $st->fetch();
  return $u ?: null;
}
function acc_new_data_key(): string {
  return bin2hex(random_bytes(16));
}
/* 作るだけ（メールは送らない）。呼ぶ側で確認メールを出す */
function acc_create(string $email, string $passHash, string $status): array {
  $now = time();
  $st  = acc_db()->prepare(
    'INSERT INTO users (email, pass_hash, status, payload, data_key, sess_epoch, created_at, updated_at)
     VALUES (?,?,?,?,?,1,?,?)'
  );
  $st->execute([$email, $passHash, $status, '{}', acc_new_data_key(), $now, $now]);
  $u = acc_find($email);
  if (!$u) throw new RuntimeException('user insert failed');
  return $u;
}

/* ===== 9. 操作 =====
   戻り値は ['ok'=>bool, 'error'=>キー, …]。error は includes/lang/*.php の acc.err.* に対応。 */

/* 新規登録。メール確認が済むまでログインさせない。
   「登録済みです」を返さない＝どのアドレスが登録済みかを外から数えられないようにする。
   登録済みだった場合は、そのアドレス宛に「もう登録があります」の案内を送るだけにする。 */
function acc_signup(string $email, string $pass, string $lang): array {
  $email = acc_norm_email($email);
  if (!acc_email_ok($email)) return ['ok' => false, 'error' => 'email'];
  if (!acc_pass_ok($pass))   return ['ok' => false, 'error' => 'password'];
  if (acc_blocked($email))   return ['ok' => false, 'error' => 'ratelimit'];
  if (acc_send_blocked($email)) return ['ok' => false, 'error' => 'toomany'];

  $u = acc_find($email);
  if ($u) {
    if ($u['status'] === 'pending') {
      /* まだ確認していないアカウント。パスワードを入れ直して確認メールをもう一度出す */
      acc_db()->prepare('UPDATE users SET pass_hash = ?, updated_at = ? WHERE id = ?')
              ->execute([password_hash($pass, PASSWORD_DEFAULT), time(), (int)$u['id']]);
      $u = acc_find($email);
      acc_send_verify($u, $lang);
    } else {
      /* 確認済み。パスワードは書き換えない（乗っ取りの入口になるため）。
         本人なら再発行から入れる、という案内だけ送る */
      if (!acc_send_blocked($email)) {
        acc_mail($email, t('acc.mail.exists_subject'), t('acc.mail.exists_body', acc_site_url()));
        acc_send_hit($email);
      }
    }
    return ['ok' => true, 'sent' => true];
  }

  $u = acc_create($email, password_hash($pass, PASSWORD_DEFAULT), 'pending');
  acc_send_verify($u, $lang);
  return ['ok' => true, 'sent' => true];
}

/* 確認メールの再送 */
function acc_resend(string $email, string $lang): array {
  $email = acc_norm_email($email);
  if (!acc_email_ok($email))    return ['ok' => false, 'error' => 'email'];
  if (acc_blocked($email))      return ['ok' => false, 'error' => 'ratelimit'];
  if (acc_send_blocked($email)) return ['ok' => false, 'error' => 'toomany'];
  $u = acc_find($email);
  if ($u && $u['status'] === 'pending') acc_send_verify($u, $lang);
  /* 見つからない・確認済みでも同じ返事にする */
  return ['ok' => true, 'sent' => true];
}

/* メール確認のリンクを踏んだとき。済んだらそのままログインさせる */
function acc_verify(string $token): array {
  $u = acc_token_take('verify', $token);
  if (!$u) return ['ok' => false, 'error' => 'token'];
  if ($u['status'] !== 'active') {
    acc_db()->prepare('UPDATE users SET status = ' . "'active'" . ', updated_at = ? WHERE id = ?')
            ->execute([time(), (int)$u['id']]);
    $st = acc_db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([(int)$u['id']]);
    $u = $st->fetch();
  }
  acc_login_session($u);
  return ['ok' => true, 'user' => $u];
}

/* ログイン */
function acc_login(string $email, string $pass): array {
  $email = acc_norm_email($email);
  if (!acc_email_ok($email) || $pass === '') return ['ok' => false, 'error' => 'signin'];
  if (acc_blocked($email))                   return ['ok' => false, 'error' => 'ratelimit'];

  $u = acc_find($email);
  /* 見つからないときも同じくらいの時間をかける＝存在の有無を応答時間から測れないようにする */
  $hash = ($u && $u['pass_hash'] !== '') ? $u['pass_hash']
        : '$2y$10$usesomesillystringfoo7BOKzJ0N0y0nJ2s9OJt0N6d0Xq0m2';
  $good = password_verify($pass, $hash);

  if (!$u || $u['pass_hash'] === '' || !$good) { acc_fail($email); return ['ok' => false, 'error' => 'signin']; }
  if ($u['status'] !== 'active')              { return ['ok' => false, 'error' => 'unverified']; }

  if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) {
    acc_db()->prepare('UPDATE users SET pass_hash = ?, updated_at = ? WHERE id = ?')
            ->execute([password_hash($pass, PASSWORD_DEFAULT), time(), (int)$u['id']]);
  }
  acc_login_session($u);
  return ['ok' => true, 'user' => acc_find($email)];
}

/* パスワード再発行の要求。存在の有無にかかわらず同じ返事にする */
function acc_forgot(string $email, string $lang): array {
  $email = acc_norm_email($email);
  if (!acc_email_ok($email))    return ['ok' => false, 'error' => 'email'];
  if (acc_blocked($email))      return ['ok' => false, 'error' => 'ratelimit'];
  if (acc_send_blocked($email)) return ['ok' => false, 'error' => 'toomany'];
  $u = acc_find($email);
  if ($u && $u['status'] === 'active' && $u['pass_hash'] !== '') acc_send_reset($u, $lang);
  return ['ok' => true, 'sent' => true];
}

/* 再発行のリンクから新しいパスワードを入れる。他の端末のセッションは全部切る */
function acc_reset(string $token, string $pass): array {
  if (!acc_pass_ok($pass)) return ['ok' => false, 'error' => 'password'];
  $u = acc_token_take('reset', $token);
  if (!$u) return ['ok' => false, 'error' => 'token'];
  acc_db()->prepare('UPDATE users SET pass_hash = ?, status = ' . "'active'" . ', updated_at = ? WHERE id = ?')
          ->execute([password_hash($pass, PASSWORD_DEFAULT), time(), (int)$u['id']]);
  acc_bump_epoch((int)$u['id']);
  $st = acc_db()->prepare('SELECT * FROM users WHERE id = ?');
  $st->execute([(int)$u['id']]);
  $u = $st->fetch();
  acc_login_session($u);        /* いま操作している端末だけ入り直す */
  return ['ok' => true, 'user' => $u];
}

/* ログイン中にパスワードを変える（今のパスワードを確かめる） */
function acc_change_pass(array $u, string $now, string $next): array {
  if (!acc_pass_ok($next)) return ['ok' => false, 'error' => 'password'];
  if ($u['pass_hash'] === '') {
    /* Google だけで入っている人。今のパスワードは無いので、そのまま設定させる */
  } elseif (!password_verify($now, $u['pass_hash'])) {
    acc_fail($u['email']);
    return ['ok' => false, 'error' => 'signin'];
  }
  acc_db()->prepare('UPDATE users SET pass_hash = ?, updated_at = ? WHERE id = ?')
          ->execute([password_hash($next, PASSWORD_DEFAULT), time(), (int)$u['id']]);
  $ep = acc_bump_epoch((int)$u['id']);
  acc_session_start();
  $_SESSION['ep'] = $ep;         /* いまの端末だけ続けて使える */
  return ['ok' => true];
}

/* 退会。譜面（scores）も一緒に消す */
function acc_delete(array $u): array {
  $db  = acc_db();
  $uid = (int)$u['id'];
  $db->beginTransaction();
  try {
    /* scores は data_key で紐づいている（includes/scores.php） */
    $db->prepare('DELETE FROM scores WHERE code = ?')->execute([$u['data_key']]);
  } catch (PDOException $ex) {
    /* まだ scores テーブルが無い場合は何もしない */
  }
  try {
    /* 公開していた楽譜（shares）も同じ data_key で紐づいている（includes/shares.php）。
       退会した人の投稿を残さないため、ここで一緒に消す。 */
    $db->prepare('DELETE FROM shares WHERE owner = ?')->execute([$u['data_key']]);
  } catch (PDOException $ex) {
    /* まだ shares テーブルが無い場合は何もしない */
  }
  $db->prepare('DELETE FROM user_tokens WHERE user_id = ?')->execute([$uid]);
  $db->prepare('DELETE FROM user_oauth  WHERE user_id = ?')->execute([$uid]);
  $db->prepare('DELETE FROM users       WHERE id = ?')->execute([$uid]);
  $db->commit();
  acc_logout();
  return ['ok' => true];
}

/* ===== 10. Google ログインの受け口（oauth/google.php から呼ぶ） =====
   Google 側で確認済みのメールだけ受ける。同じメールの会員が既にいれば結びつける。 */
function acc_oauth_google(string $sub, string $email, bool $emailVerified): array {
  $sub = trim($sub);
  if ($sub === '') return ['ok' => false, 'error' => 'oauth'];
  $db  = acc_db();
  $now = time();

  /* 1) 前に結びつけた人 */
  $st = $db->prepare('SELECT u.* FROM user_oauth o JOIN users u ON u.id = o.user_id WHERE o.provider = ' . "'google'" . ' AND o.sub = ?');
  $st->execute([$sub]);
  $u = $st->fetch();
  if ($u) {
    if ($u['status'] !== 'active') {
      $db->prepare('UPDATE users SET status = ' . "'active'" . ', updated_at = ? WHERE id = ?')->execute([$now, (int)$u['id']]);
      $st2 = $db->prepare('SELECT * FROM users WHERE id = ?'); $st2->execute([(int)$u['id']]); $u = $st2->fetch();
    }
    acc_login_session($u);
    return ['ok' => true, 'user' => $u];
  }

  /* 2) 初めての Google。メールで引き当てる。確認できていないメールは受けない */
  $email = acc_norm_email($email);
  if (!$emailVerified || !acc_email_ok($email)) return ['ok' => false, 'error' => 'oauth_email'];

  $u = acc_find($email);
  if (!$u) {
    /* Google が確認済みのアドレスなので、こちらの確認メールは要らない＝そのまま active */
    $u = acc_create($email, '', 'active');
  } elseif ($u['status'] !== 'active') {
    $db->prepare('UPDATE users SET status = ' . "'active'" . ', updated_at = ? WHERE id = ?')->execute([$now, (int)$u['id']]);
    $u = acc_find($email);
  }
  $db->prepare('INSERT OR IGNORE INTO user_oauth (provider, sub, user_id, created_at) VALUES (' . "'google'" . ',?,?,?)')
     ->execute([$sub, (int)$u['id'], $now]);
  acc_login_session($u);
  return ['ok' => true, 'user' => $u];
}

/* ===== 11. 設定（旧 saves.payload） ===== */
function acc_payload_ok(string $payload): bool {
  if ($payload === '' || strlen($payload) > ACC_MAX_BYTES) return false;
  return is_array(json_decode($payload, true));
}
function acc_payload_get(array $u) {
  return json_decode((string)$u['payload'], true);
}
function acc_payload_put(array $u, string $payload): array {
  if (!acc_payload_ok($payload)) return ['ok' => false, 'error' => 'payload'];
  acc_db()->prepare('UPDATE users SET payload = ?, updated_at = ? WHERE id = ?')
          ->execute([$payload, time(), (int)$u['id']]);
  return ['ok' => true];
}

/* 画面へ返す「いまのアカウント」。パスワードや内部キーは出さない。
   admin は config/app.php の admin_email と一致する人だけ true になる
   ＝この人の画面にだけ、歯車の中に「共有曲の管理」が出る（判定はサーバ側でも必ず行う）。 */
function acc_public(?array $u): ?array {
  if (!$u) return null;
  return [
    'email'    => $u['email'],
    'hasPass'  => $u['pass_hash'] !== '',
    'verified' => $u['status'] === 'active',
    'admin'    => (APP_ADMIN_EMAIL !== '' && strtolower((string)$u['email']) === APP_ADMIN_EMAIL),
  ];
}
