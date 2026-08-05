<?php
/*
  includes/shares.php — 読み込んだ楽譜を「みんなの曲」として公開するための土台。

  アカウント（includes/account.php）・アップロードした楽譜（includes/scores.php）と
  同じ SQLite ファイルを使う。こちらは「公開された譜面1件＝1行」。

  ・公開するのは scores の1件をそのまま写したもの（音の並びだけ）。
    元のMIDI（src）も運指（fing）も写さない＝公開されるのは譜面の音そのものだけ。
  ・伴奏コードは持たない。共有された曲に伴奏が付かないのはこのため
    （伴奏は public/songs/*.json の chords を持つ曲だけの機能）。
  ・難易度（level）も持たない。共有された曲に★を出さないのはこのため。
  ・status は 'public'（公開中）/ 'hidden'（非公開）/ 'deleted'（削除済み）の3つ。
    削除依頼を受けた時点で 'hidden' にする＝運営が見るまで表には出さない。
  ・非公開・削除ができるのは投稿者本人と管理者（config/app.php の admin_email）だけ。

  ※ このファイルは includes/account.php と includes/scores.php を読み込んだ後に
     require すること（acc_db / acc_current / SCORE_* を使う）。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

const SHARE_MAX_ITEMS = 20;      /* 1アカウントが公開できる件数 */
const SHARE_PAGE      = 50;      /* 一覧1ページの件数（画面側のページネーションと合わせる） */
const SHARE_NAME_MAX  = 120;     /* 一覧に出す曲名の長さ */
const SHARE_SUB_MAX   = 80;      /* 副題（MIDIで選んでいたトラック名）の長さ */
const SHARE_MAX_BYTES = 512000;  /* 譜面1件の JSON の上限（scores と同じ） */
const SHARE_Q_MAX     = 60;      /* 絞り込みに使える文字数 */

/* テーブルは初回アクセス時に作る（users / scores と同じファイルの中） */
function share_table(PDO $db): void {
  static $done = false;
  if ($done) return;
  $db->exec(
    'CREATE TABLE IF NOT EXISTS shares (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       owner      TEXT    NOT NULL,
       owner_id   INTEGER NOT NULL DEFAULT 0,
       name       TEXT    NOT NULL,
       sub        TEXT    NOT NULL DEFAULT \'\',
       notes      INTEGER NOT NULL DEFAULT 0,
       data       TEXT    NOT NULL,
       sig        TEXT    NOT NULL DEFAULT \'\',
       status     TEXT    NOT NULL DEFAULT \'public\',
       reports    INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )'
  );
  $db->exec('CREATE INDEX IF NOT EXISTS ix_shares_status ON shares (status, id)');
  $db->exec('CREATE INDEX IF NOT EXISTS ix_shares_owner  ON shares (owner, id)');
  $done = true;
}

/* ===== 管理者の判定 =====
   config/app.php の admin_email と一致する人だけ。空文字の設定なら誰も管理者にならない。 */
function share_is_admin(?array $u): bool {
  if (!$u || APP_ADMIN_EMAIL === '') return false;
  return strtolower((string)$u['email']) === APP_ADMIN_EMAIL;
}

/* 入力の整え（scores と同じ作法。文字の途中で切らない） */
function share_clean(string $s, int $max): string {
  $s = trim(preg_replace('/[\x00-\x1f]+/', ' ', $s));
  if (preg_match('/\A.{0,' . $max . '}/us', $s, $m)) return $m[0];
  return substr($s, 0, $max);
}

/* 絞り込みの語。LIKE に渡すのでワイルドカードは潰しておく */
function share_like(string $q): string {
  $q = share_clean($q, SHARE_Q_MAX);
  return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
}

/* 1行 → 画面へ返す形。data（譜面本体）は一覧では返さない＝通信を軽くする */
function share_row(array $r, ?array $u): array {
  $mine = ($u && (string)$r['owner'] === (string)$u['data_key']);
  return [
    'id'         => (int)$r['id'],
    'name'       => (string)$r['name'],
    'sub'        => (string)$r['sub'],
    'notes'      => (int)$r['notes'],
    'status'     => (string)$r['status'],
    'reports'    => (int)$r['reports'],
    'mine'       => $mine,
    'updated_at' => (int)$r['updated_at'],
  ];
}

/* ===== 一覧（公開中のみ・新しい順） =====
   ログインしていなくても見られる（曲一覧は誰でも開ける画面のため）。
   $q が空でなければ曲名・副題の部分一致で絞る。1ページ SHARE_PAGE 件。 */
function share_list(string $q = '', int $page = 1, ?array $u = null): array {
  $db = acc_db();
  share_table($db);

  $q    = share_like($q);
  $page = max(1, $page);
  $off  = ($page - 1) * SHARE_PAGE;

  if ($q === '') {
    $cs = $db->prepare("SELECT COUNT(*) FROM shares WHERE status = 'public'");
    $cs->execute();
    $total = (int)$cs->fetchColumn();
    $st = $db->prepare("SELECT * FROM shares WHERE status = 'public' ORDER BY id DESC LIMIT ? OFFSET ?");
    $st->execute([SHARE_PAGE, $off]);
  } else {
    $like = '%' . $q . '%';
    $cs = $db->prepare("SELECT COUNT(*) FROM shares WHERE status = 'public' AND (name LIKE ? ESCAPE '\\' OR sub LIKE ? ESCAPE '\\')");
    $cs->execute([$like, $like]);
    $total = (int)$cs->fetchColumn();
    $st = $db->prepare("SELECT * FROM shares WHERE status = 'public' AND (name LIKE ? ESCAPE '\\' OR sub LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT ? OFFSET ?");
    $st->execute([$like, $like, SHARE_PAGE, $off]);
  }

  $rows = [];
  foreach ($st->fetchAll() as $r) { $rows[] = share_row($r, $u); }
  return ['ok' => true, 'items' => $rows, 'total' => $total, 'page' => $page, 'per' => SHARE_PAGE];
}

/* 1件取り出す（譜面本体つき）。公開中のものだけ。管理者は非公開のものも開ける */
function share_load(int $id, ?array $u = null): array {
  $db = acc_db();
  share_table($db);

  $st = $db->prepare('SELECT * FROM shares WHERE id = ?');
  $st->execute([$id]);
  $r = $st->fetch();
  if (!$r) return ['ok' => false, 'error' => 'notfound'];

  $mine = ($u && (string)$r['owner'] === (string)$u['data_key']);
  if ($r['status'] !== 'public' && !$mine && !share_is_admin($u)) {
    return ['ok' => false, 'error' => 'notfound'];
  }

  return [
    'ok'    => true,
    'id'    => (int)$r['id'],
    'name'  => (string)$r['name'],
    'sub'   => (string)$r['sub'],
    'notes' => (int)$r['notes'],
    'data'  => json_decode((string)$r['data'], true),
  ];
}

/* ===== 公開する =====
   画面から譜面を送り直させず、アップロード済み（scores）の1件を写す。
   $agree は利用規約への同意。付いていなければ受け付けない（画面のチェックと二重に見る）。 */
function share_create(array $u, int $scoreId, string $name, bool $agree): array {
  if (!$agree) return ['ok' => false, 'error' => 'agree'];

  $db = acc_db();
  share_table($db);
  score_table($db);

  $st = $db->prepare('SELECT id, name, sub, notes, data, sig FROM scores WHERE code = ? AND id = ?');
  $st->execute([(string)$u['data_key'], $scoreId]);
  $row = $st->fetch();
  if (!$row) return ['ok' => false, 'error' => 'notfound'];

  $data = (string)$row['data'];
  if ($data === '' || strlen($data) > SHARE_MAX_BYTES)  return ['ok' => false, 'error' => 'payload'];
  if (!is_array(json_decode($data, true)))              return ['ok' => false, 'error' => 'payload'];

  $name = share_clean($name !== '' ? $name : (string)$row['name'], SHARE_NAME_MAX);
  if ($name === '') $name = 'score';
  $sub = share_clean((string)$row['sub'], SHARE_SUB_MAX);
  $sig = substr(preg_replace('/[^A-Za-z0-9]/', '', (string)$row['sig']), 0, 32);

  /* 同じ譜面を二重に公開させない（取り消したもの＝deleted は数えない） */
  $q = $db->prepare("SELECT id FROM shares WHERE owner = ? AND sig = ? AND sig <> '' AND status <> 'deleted'");
  $q->execute([(string)$u['data_key'], $sig]);
  if ($q->fetchColumn()) return ['ok' => false, 'error' => 'dup'];

  $c = $db->prepare("SELECT COUNT(*) FROM shares WHERE owner = ? AND status <> 'deleted'");
  $c->execute([(string)$u['data_key']]);
  if (((int)$c->fetchColumn()) >= SHARE_MAX_ITEMS) return ['ok' => false, 'error' => 'sharelimit'];

  $now = time();
  $db->prepare('INSERT INTO shares (owner, owner_id, name, sub, notes, data, sig, status, reports, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,' . "'public'" . ',0,?,?)')
     ->execute([(string)$u['data_key'], (int)$u['id'], $name, $sub, (int)$row['notes'], $data, $sig, $now, $now]);

  return ['ok' => true, 'id' => (int)$db->lastInsertId()];
}

/* 公開をやめる（投稿者本人）。行は残さず消す */
function share_remove(array $u, int $id): array {
  $db = acc_db();
  share_table($db);
  $st = $db->prepare('DELETE FROM shares WHERE id = ? AND owner = ?');
  $st->execute([$id, (string)$u['data_key']]);
  if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];
  return ['ok' => true, 'id' => $id];
}

/* ===== 削除依頼 =====
   受け付けた時点で非公開にする（運営が見るまで表には出さない）。
   同じ人が何度押しても件数は増えるだけで、状態は 'hidden' のまま。 */
function share_report(array $u, int $id): array {
  $db = acc_db();
  share_table($db);

  $st = $db->prepare('SELECT id, status FROM shares WHERE id = ?');
  $st->execute([$id]);
  $r = $st->fetch();
  if (!$r) return ['ok' => false, 'error' => 'notfound'];

  $next = ($r['status'] === 'deleted') ? 'deleted' : 'hidden';
  $db->prepare('UPDATE shares SET status = ?, reports = reports + 1, updated_at = ? WHERE id = ?')
     ->execute([$next, time(), $id]);
  return ['ok' => true, 'id' => $id];
}

/* ===== 管理（config/app.php の admin_email だけ） ===== */

/* 全件（非公開のものも含む）。絞り込みとページ送りは公開一覧と同じ */
function share_admin_list(string $q = '', int $page = 1): array {
  $db = acc_db();
  share_table($db);

  $q    = share_like($q);
  $page = max(1, $page);
  $off  = ($page - 1) * SHARE_PAGE;

  if ($q === '') {
    $cs = $db->prepare("SELECT COUNT(*) FROM shares WHERE status <> 'deleted'");
    $cs->execute();
    $total = (int)$cs->fetchColumn();
    $st = $db->prepare("SELECT * FROM shares WHERE status <> 'deleted' ORDER BY id DESC LIMIT ? OFFSET ?");
    $st->execute([SHARE_PAGE, $off]);
  } else {
    $like = '%' . $q . '%';
    $cs = $db->prepare("SELECT COUNT(*) FROM shares WHERE status <> 'deleted' AND (name LIKE ? ESCAPE '\\' OR sub LIKE ? ESCAPE '\\')");
    $cs->execute([$like, $like]);
    $total = (int)$cs->fetchColumn();
    $st = $db->prepare("SELECT * FROM shares WHERE status <> 'deleted' AND (name LIKE ? ESCAPE '\\' OR sub LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT ? OFFSET ?");
    $st->execute([$like, $like, SHARE_PAGE, $off]);
  }

  $rows = [];
  foreach ($st->fetchAll() as $r) { $rows[] = share_row($r, null); }
  return ['ok' => true, 'items' => $rows, 'total' => $total, 'page' => $page, 'per' => SHARE_PAGE];
}

/* 公開 / 非公開の切り替え */
function share_admin_status(int $id, string $status): array {
  if ($status !== 'public' && $status !== 'hidden') return ['ok' => false, 'error' => 'method'];
  $db = acc_db();
  share_table($db);
  $st = $db->prepare('UPDATE shares SET status = ?, updated_at = ? WHERE id = ?');
  $st->execute([$status, time(), $id]);
  if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];
  return ['ok' => true, 'id' => $id, 'status' => $status];
}

/* 消す（行ごと消す。元に戻せない） */
function share_admin_delete(int $id): array {
  $db = acc_db();
  share_table($db);
  $st = $db->prepare('DELETE FROM shares WHERE id = ?');
  $st->execute([$id]);
  if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];
  return ['ok' => true, 'id' => $id];
}
