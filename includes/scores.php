<?php
/*
  includes/scores.php — アップロードした楽譜を保存番号に紐づけて預かる土台。

  設定の保存（includes/auth.php）と同じ SQLite ファイル・同じ保存番号を使う。
  こちらは「譜面1件＝1行」で、保存番号ごとに最大 SCORE_MAX_ITEMS 件まで持てる。

  ・預かるのは音の並び（[開始拍, 長さ, 小節, [midi…], リード番号]）と運指だけ。
    元のファイル（MusicXML / MIDI / PDF）は預からない。個人を特定できる情報も入らない。
  ・運指は data とは別の列（fing）に持つ。運指を直しただけのときに sig（内容の指紋）が
    変わらないようにするため＝「同じ譜面か」の判定が運指の編集で揺れない。
  ・書き込みの前に「その保存番号が実在するか」を必ず確かめる（存在しない番号の行を作らない）。
  ・総当たり対策は includes/auth.php の save_rate_* をそのまま使う（窓・回数も共通）。

  ※ このファイルは includes/auth.php を読み込んだ後に require すること
     （save_db / save_norm_code / save_code_ok / save_rate_* を使う）。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

const SCORE_MAX_ITEMS = 99;      /* 保存番号1つあたりの件数の上限 */
const SCORE_MAX_BYTES = 512000;  /* 譜面1件の JSON の上限（約500KB） */
const SCORE_NAME_MAX  = 120;     /* 一覧に出す名前の長さ */
const SCORE_SUB_MAX   = 80;      /* 副題（MIDIで選んだトラック名）の長さ */

/* テーブルは初回アクセス時に作る（saves と同じファイルの中）。
   列を足したときは、既に出来ているテーブルにも ALTER で足す（作り直さない＝データを消さない）。 */
function score_table(PDO $db): void {
  static $done = false;
  if ($done) return;
  $db->exec(
    'CREATE TABLE IF NOT EXISTS scores (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       code       TEXT    NOT NULL,
       name       TEXT    NOT NULL,
       sub        TEXT    NOT NULL DEFAULT \'\',
       notes      INTEGER NOT NULL DEFAULT 0,
       data       TEXT    NOT NULL,
       sig        TEXT    NOT NULL DEFAULT \'\',
       fing       TEXT    NOT NULL DEFAULT \'\',
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )'
  );
  /* 先の版で作られたテーブルには sig / fing が無いので足す */
  $have = [];
  foreach ($db->query('PRAGMA table_info(scores)') as $c) { $have[(string)($c['name'] ?? '')] = true; }
  if (!isset($have['sig']))  $db->exec("ALTER TABLE scores ADD COLUMN sig  TEXT NOT NULL DEFAULT ''");
  if (!isset($have['fing'])) $db->exec("ALTER TABLE scores ADD COLUMN fing TEXT NOT NULL DEFAULT ''");
  if (!isset($have['sub']))  $db->exec("ALTER TABLE scores ADD COLUMN sub  TEXT NOT NULL DEFAULT ''");
  $db->exec('CREATE INDEX IF NOT EXISTS ix_scores_code ON scores (code, id)');
  $done = true;
}

/* 保存番号の検証（形・レート制限・実在）。通れば ['ok'=>true,'db'=>…,'code'=>…] */
function score_open(string $code): array {
  $db = save_db();
  score_table($db);
  $code = save_norm_code($code);

  if (save_rate_blocked($db)) return ['ok' => false, 'error' => 'ratelimit'];
  if (!save_code_ok($code))   { save_rate_hit($db); return ['ok' => false, 'error' => 'code']; }

  $st = $db->prepare('SELECT 1 FROM saves WHERE code = ?');
  $st->execute([$code]);
  if (!$st->fetchColumn()) { save_rate_hit($db); return ['ok' => false, 'error' => 'notfound']; }

  return ['ok' => true, 'db' => $db, 'code' => $code];
}

/* 一覧（新しいものから）。data は返さない＝一覧の通信を軽くする */
function score_list(string $code): array {
  $g = score_open($code);
  if (!$g['ok']) return $g;

  $st = $g['db']->prepare('SELECT id, name, sub, notes, sig, updated_at FROM scores WHERE code = ? ORDER BY id DESC');
  $st->execute([$g['code']]);
  $rows = [];
  foreach ($st->fetchAll() as $r) {
    $rows[] = [
      'id'         => (int)$r['id'],
      'name'       => (string)$r['name'],
      /* 副題＝MIDIで選んでいたトラック名（無いこともある） */
      'sub'        => (string)$r['sub'],
      'notes'      => (int)$r['notes'],
      'sig'        => (string)$r['sig'],
      'updated_at' => (int)$r['updated_at'],
    ];
  }
  return ['ok' => true, 'items' => $rows];
}

/* 保存。$id を渡せばその1件を上書きし、渡さなければ新しく追加する。
   「同じ譜面っぽいものがあるか」の判定と、上書き / 新規追加の選択は画面側（src/uploads.js）で行う
   ＝サーバが黙って上書きすることはない。 */
function score_save(string $code, string $name, int $notes, string $data, string $sig = '', string $fing = '', int $id = 0, string $sub = ''): array {
  $g = score_open($code);
  if (!$g['ok']) return $g;
  $db = $g['db']; $code = $g['code'];

  $name = trim(preg_replace('/[\x00-\x1f]+/', ' ', $name));
  if ($name === '') $name = 'score';
  /* 長さの切り詰めは mbstring に頼らず PCRE の /u で行う（文字の途中で切らない）。
     不正な UTF-8 で失敗したときだけバイト単位で落とす。 */
  if (preg_match('/\A.{0,' . SCORE_NAME_MAX . '}/us', $name, $m)) { $name = $m[0]; }
  else { $name = substr($name, 0, SCORE_NAME_MAX); }
  $notes = max(0, $notes);

  if ($data === '' || strlen($data) > SCORE_MAX_BYTES) return ['ok' => false, 'error' => 'payload'];
  if (!is_array(json_decode($data, true)))              return ['ok' => false, 'error' => 'payload'];

  if (strlen($fing) > SCORE_MAX_BYTES) return ['ok' => false, 'error' => 'payload'];
  $sig = substr(preg_replace('/[^A-Za-z0-9]/', '', $sig), 0, 32);
  $sub = trim(preg_replace('/[\x00-\x1f]+/', ' ', $sub));
  if (preg_match('/\A.{0,' . SCORE_SUB_MAX . '}/us', $sub, $ms)) { $sub = $ms[0]; }
  else { $sub = substr($sub, 0, SCORE_SUB_MAX); }
  $now = time();

  /* 上書き（画面で選ばれた1件だけ。自分の保存番号のものに限る） */
  if ($id > 0) {
    $st = $db->prepare('UPDATE scores SET name = ?, sub = ?, notes = ?, data = ?, sig = ?, fing = ?, updated_at = ? WHERE code = ? AND id = ?');
    $st->execute([$name, $sub, $notes, $data, $sig, $fing, $now, $code, $id]);
    if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];
    return ['ok' => true, 'id' => $id, 'mode' => 'update'];
  }

  /* 新規追加 */
  $st = $db->prepare('SELECT COUNT(*) FROM scores WHERE code = ?');
  $st->execute([$code]);
  if (((int)$st->fetchColumn()) >= SCORE_MAX_ITEMS) return ['ok' => false, 'error' => 'limit'];

  $db->prepare('INSERT INTO scores (code, name, sub, notes, data, sig, fing, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
     ->execute([$code, $name, $sub, $notes, $data, $sig, $fing, $now, $now]);
  return ['ok' => true, 'id' => (int)$db->lastInsertId(), 'mode' => 'insert'];
}

/* 運指だけを更新する（譜面本体は触らない＝sig は変わらない）。
   アップロードした譜面を開いているあいだ、運指を直すたびに呼ばれる。 */
function score_fing(string $code, int $id, string $fing): array {
  $g = score_open($code);
  if (!$g['ok']) return $g;
  if (strlen($fing) > SCORE_MAX_BYTES) return ['ok' => false, 'error' => 'payload'];

  $st = $g['db']->prepare('UPDATE scores SET fing = ?, updated_at = ? WHERE code = ? AND id = ?');
  $st->execute([$fing, time(), $g['code'], $id]);
  if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];

  return ['ok' => true, 'id' => $id];
}

/* 1件取り出す（自分の保存番号のものだけ） */
function score_load(string $code, int $id): array {
  $g = score_open($code);
  if (!$g['ok']) return $g;

  $st = $g['db']->prepare('SELECT id, name, notes, data, fing FROM scores WHERE code = ? AND id = ?');
  $st->execute([$g['code'], $id]);
  $row = $st->fetch();
  if (!$row) return ['ok' => false, 'error' => 'notfound'];

  return [
    'ok'   => true,
    'id'   => (int)$row['id'],
    'name' => (string)$row['name'],
    'data' => json_decode($row['data'], true),
    /* 運指は無いこともある（先の版で保存したもの・一度も直していないもの） */
    'fing' => ($row['fing'] === '') ? null : json_decode($row['fing'], true),
  ];
}

function score_delete(string $code, int $id): array {
  $g = score_open($code);
  if (!$g['ok']) return $g;

  $st = $g['db']->prepare('DELETE FROM scores WHERE code = ? AND id = ?');
  $st->execute([$g['code'], $id]);
  if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];

  return ['ok' => true, 'id' => $id];
}
