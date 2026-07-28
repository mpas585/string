<?php
/*
  includes/auth.php — 保存番号（英字1文字＋数字4桁）で設定を預かる土台。

  「ログイン」ではなく「保存」。メールアドレスもパスワードもセッションも無い。
  利用者は保存番号だけで自分のデータを指す。同じ端末では番号を LocalStorage に置き、
  起動時に自動で読み込む（＝番号を打つのは他の端末に移るときだけ）。

  ・保存先は SQLite 1ファイル（config/app.php の 'db_path'）。無ければ初回アクセス時に作る。
  ・保存番号は英字1文字＋数字4桁。読み違えやすい I / L / O は英字から外してある。
  ・番号だけが鍵なので、存在しない番号を叩き続けられると総当たりになる。
    IP ごとに「外れた回数」を数え、一定回数を超えたら一定時間だけ受け付けない。
  ・預かるのは画面の設定（テンポ・運指など）だけ。個人を特定できる情報は入れない。

  ※ ニックネーム＋暗証番号の会員（users テーブル）は廃止した。既存の app.db には
     users が残っているが参照しない。消したいときは手で DROP TABLE users すること
     （自動で消さないのは、切り戻しの余地を残すため）。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

/* 保存番号の頭1文字に使う英字。I / L / O は 1 / 0 と読み違えるので入れない（23文字） */
const SAVE_ALPHA     = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const SAVE_GEN_TRY   = 40;      /* 番号が重複したときに引き直す回数 */
const SAVE_MAX_BYTES = 512000;  /* 預かる JSON の上限（約500KB） */
const SAVE_RATE_SEC  = 600;     /* 総当たりを見る窓（10分） */
const SAVE_RATE_MAX  = 20;      /* 窓の中で許す「外れ」の回数。超えたら窓が空くまで拒否 */

function save_db(): PDO {
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
    'CREATE TABLE IF NOT EXISTS saves (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       code       TEXT    NOT NULL UNIQUE,
       payload    TEXT    NOT NULL DEFAULT ' . "'{}'" . ',
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )'
  );
  /* 総当たり対策。外れた回数だけを記録する（当たったリクエストは残さない） */
  $pdo->exec(
    'CREATE TABLE IF NOT EXISTS save_hits (
       ip TEXT    NOT NULL,
       ts INTEGER NOT NULL
     )'
  );
  $pdo->exec('CREATE INDEX IF NOT EXISTS ix_save_hits ON save_hits (ip, ts)');
  @chmod($path, 0600);
  return $pdo;
}

/* ===== 保存番号 ===== */
/* 打ち間違い（空白・ハイフン・小文字）は受け取る側で吸収する */
function save_norm_code(string $code): string {
  return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code));
}
function save_code_ok(string $code): bool {
  if (strlen($code) !== 5) return false;
  if (strpos(SAVE_ALPHA, $code[0]) === false) return false;
  return (bool)preg_match('/\A[0-9]{4}\z/', substr($code, 1));
}
function save_gen_code(): string {
  $a = SAVE_ALPHA[random_int(0, strlen(SAVE_ALPHA) - 1)];
  return $a . str_pad((string)random_int(0, 9999), 4, '0', STR_PAD_LEFT);
}

/* ===== レート制限（存在確認の総当たり対策） ===== */
function save_ip(): string {
  return (string)($_SERVER['REMOTE_ADDR'] ?? '-');
}
function save_rate_blocked(PDO $db): bool {
  $now = time();
  /* 窓から出た記録は毎回まとめて捨てる（別途の掃除を要らなくするため） */
  $db->prepare('DELETE FROM save_hits WHERE ts < ?')->execute([$now - SAVE_RATE_SEC]);
  $st = $db->prepare('SELECT COUNT(*) FROM save_hits WHERE ip = ? AND ts >= ?');
  $st->execute([save_ip(), $now - SAVE_RATE_SEC]);
  return ((int)$st->fetchColumn()) >= SAVE_RATE_MAX;
}
function save_rate_hit(PDO $db): void {
  $db->prepare('INSERT INTO save_hits (ip, ts) VALUES (?,?)')->execute([save_ip(), time()]);
}

/* ===== 預かるデータ ===== */
function save_payload_ok(string $payload): bool {
  if ($payload === '' || strlen($payload) > SAVE_MAX_BYTES) return false;
  return is_array(json_decode($payload, true));
}

/* ===== 操作 =====
   戻り値は ['ok'=>bool, 'error'=>string, …]。
   error は文言キー（includes/lang/*.php の save.err.* ）に対応させている。 */
function save_create(string $payload): array {
  if (!save_payload_ok($payload)) return ['ok' => false, 'error' => 'payload'];

  $db  = save_db();
  $now = time();
  $st  = $db->prepare('INSERT INTO saves (code, payload, created_at, updated_at) VALUES (?,?,?,?)');
  for ($i = 0; $i < SAVE_GEN_TRY; $i++) {
    $code = save_gen_code();
    try {
      $st->execute([$code, $payload, $now, $now]);
      return ['ok' => true, 'code' => $code];
    } catch (PDOException $ex) {
      /* UNIQUE 衝突だけ引き直す。それ以外はそのまま投げて 500 にする */
      if ((string)$ex->getCode() !== '23000') throw $ex;
    }
  }
  return ['ok' => false, 'error' => 'full'];
}

function save_load(string $code): array {
  $db   = save_db();
  $code = save_norm_code($code);
  if (save_rate_blocked($db))  return ['ok' => false, 'error' => 'ratelimit'];
  if (!save_code_ok($code))    { save_rate_hit($db); return ['ok' => false, 'error' => 'code']; }

  $st = $db->prepare('SELECT code, payload FROM saves WHERE code = ?');
  $st->execute([$code]);
  $row = $st->fetch();
  if (!$row) { save_rate_hit($db); return ['ok' => false, 'error' => 'notfound']; }

  return ['ok' => true, 'code' => $row['code'], 'payload' => json_decode($row['payload'], true)];
}

function save_update(string $code, string $payload): array {
  $db   = save_db();
  $code = save_norm_code($code);
  if (save_rate_blocked($db))        return ['ok' => false, 'error' => 'ratelimit'];
  if (!save_code_ok($code))          { save_rate_hit($db); return ['ok' => false, 'error' => 'code']; }
  if (!save_payload_ok($payload))    return ['ok' => false, 'error' => 'payload'];

  $st = $db->prepare('UPDATE saves SET payload = ?, updated_at = ? WHERE code = ?');
  $st->execute([$payload, time(), $code]);
  if ($st->rowCount() < 1) { save_rate_hit($db); return ['ok' => false, 'error' => 'notfound']; }

  return ['ok' => true, 'code' => $code];
}

function save_delete(string $code): array {
  $db   = save_db();
  $code = save_norm_code($code);
  if (save_rate_blocked($db))  return ['ok' => false, 'error' => 'ratelimit'];
  if (!save_code_ok($code))    { save_rate_hit($db); return ['ok' => false, 'error' => 'code']; }

  $st = $db->prepare('DELETE FROM saves WHERE code = ?');
  $st->execute([$code]);
  if ($st->rowCount() < 1) { save_rate_hit($db); return ['ok' => false, 'error' => 'notfound']; }

  return ['ok' => true, 'code' => $code];
}
