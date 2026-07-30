<?php
/*
  includes/scores.php — アップロードした楽譜をアカウントに紐づけて預かる土台。

  アカウント（includes/account.php）と同じ SQLite ファイルを使う。
  こちらは「譜面1件＝1行」で、アカウントごとに最大 SCORE_MAX_ITEMS 件まで持てる。

  ・預かるのは音の並び（[開始拍, 長さ, 小節, [midi…], リード番号]）と運指、
    それに MIDI の場合だけ元ファイル（src 列・base64）。個人を特定できる情報は入らない。
  ・MIDI の元ファイルを預かるのは、一覧から開き直したあとにトラックを選び直せるようにするため
    （音の並びだけでは、選ばなかったトラックが失われる）。MusicXML では預からない。
  ・運指は data とは別の列（fing）に持つ。運指を直しただけのときに sig（内容の指紋）が
    変わらないようにするため＝「同じ譜面か」の判定が運指の編集で揺れない。
  ・どの行を触れるかはログイン中のアカウントから決める。画面から送られた値では決めない
    （旧版は保存番号を画面から受け取っていたが、今はセッションだけを見る）。
  ・scores.code 列には users.data_key を入れる。列名は旧版のままにしてある
    （既に出来ているテーブルを作り直さないため）。

  ※ このファイルは includes/account.php を読み込んだ後に require すること
     （acc_db / acc_current を使う）。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

const SCORE_MAX_ITEMS = 99;      /* アカウント1つあたりの件数の上限 */
const SCORE_MAX_BYTES = 512000;  /* 譜面1件の JSON の上限（約500KB） */
const SCORE_NAME_MAX  = 120;     /* 一覧に出す名前の長さ */
const SCORE_SUB_MAX   = 80;      /* 副題（MIDIで選んだトラック名）の長さ */
const SCORE_SRC_MAX   = 400000;  /* 元のMIDI（base64）の上限。約300KBのMIDIまで */

/* テーブルは初回アクセス時に作る（users と同じファイルの中）。
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
       src        TEXT    NOT NULL DEFAULT \'\',
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
  if (!isset($have['src']))  $db->exec("ALTER TABLE scores ADD COLUMN src  TEXT NOT NULL DEFAULT ''");
  $db->exec('CREATE INDEX IF NOT EXISTS ix_scores_code ON scores (code, id)');
  $done = true;
}

/* ログイン中のアカウントを見て、触れてよい行のキーを決める。
   通れば ['ok'=>true,'db'=>…,'code'=>…]。code は users.data_key。
   画面からは何も受け取らないので、他人の行を指すことができない。 */
function score_open(): array {
  $u = acc_current();
  if (!$u) return ['ok' => false, 'error' => 'needlogin'];

  $db = acc_db();
  score_table($db);

  return ['ok' => true, 'db' => $db, 'code' => (string)$u['data_key']];
}

/* 一覧（新しいものから）。data は返さない＝一覧の通信を軽くする */
function score_list(): array {
  $g = score_open();
  if (!$g['ok']) return $g;

  $st = $g['db']->prepare("SELECT id, name, sub, notes, sig, updated_at, (src <> '') AS hassrc FROM scores WHERE code = ? ORDER BY id DESC");
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
      /* 元のMIDIを持っている＝一覧から「トラック」を選び直せる */
      'hassrc'     => ((int)$r['hassrc'] === 1),
      'updated_at' => (int)$r['updated_at'],
    ];
  }
  return ['ok' => true, 'items' => $rows];
}

/* 保存。$id を渡せばその1件を上書きし、渡さなければ新しく追加する。
   「同じ譜面っぽいものがあるか」の判定と、上書き / 新規追加の選択は画面側（src/uploads.js）で行う
   ＝サーバが黙って上書きすることはない。 */
function score_save(string $name, int $notes, string $data, string $sig = '', string $fing = '', int $id = 0, string $sub = '', ?string $src = null): array {
  $g = score_open();
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
  /* $src が null は「触らない」。文字列なら base64 として受け取る。大きすぎるものは預からない
     （読み込み自体は成功させたいのでエラーにはせず空にする＝トラック選択だけできなくなる） */
  if ($src !== null) {
    $src = preg_replace('/[^A-Za-z0-9+\/=]/', '', $src);
    if (strlen($src) > SCORE_SRC_MAX) $src = '';
  }
  $sig = substr(preg_replace('/[^A-Za-z0-9]/', '', $sig), 0, 32);
  $sub = trim(preg_replace('/[\x00-\x1f]+/', ' ', $sub));
  if (preg_match('/\A.{0,' . SCORE_SUB_MAX . '}/us', $sub, $ms)) { $sub = $ms[0]; }
  else { $sub = substr($sub, 0, SCORE_SUB_MAX); }
  $now = time();

  /* 上書き（画面で選ばれた1件だけ。自分のアカウントのものに限る） */
  if ($id > 0) {
    if ($src === null) {
      $st = $db->prepare('UPDATE scores SET name = ?, sub = ?, notes = ?, data = ?, sig = ?, fing = ?, updated_at = ? WHERE code = ? AND id = ?');
      $st->execute([$name, $sub, $notes, $data, $sig, $fing, $now, $code, $id]);
    } else {
      $st = $db->prepare('UPDATE scores SET name = ?, sub = ?, notes = ?, data = ?, sig = ?, fing = ?, src = ?, updated_at = ? WHERE code = ? AND id = ?');
      $st->execute([$name, $sub, $notes, $data, $sig, $fing, $src, $now, $code, $id]);
    }
    if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];
    return ['ok' => true, 'id' => $id, 'mode' => 'update'];
  }

  /* 新規追加 */
  $st = $db->prepare('SELECT COUNT(*) FROM scores WHERE code = ?');
  $st->execute([$code]);
  if (((int)$st->fetchColumn()) >= SCORE_MAX_ITEMS) return ['ok' => false, 'error' => 'limit'];

  $db->prepare('INSERT INTO scores (code, name, sub, notes, data, sig, fing, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
     ->execute([$code, $name, $sub, $notes, $data, $sig, $fing, (string)$src, $now, $now]);
  return ['ok' => true, 'id' => (int)$db->lastInsertId(), 'mode' => 'insert'];
}

/* 運指だけを更新する（譜面本体は触らない＝sig は変わらない）。
   アップロードした譜面を開いているあいだ、運指を直すたびに呼ばれる。 */
function score_fing(int $id, string $fing): array {
  $g = score_open();
  if (!$g['ok']) return $g;
  if (strlen($fing) > SCORE_MAX_BYTES) return ['ok' => false, 'error' => 'payload'];

  $st = $g['db']->prepare('UPDATE scores SET fing = ?, updated_at = ? WHERE code = ? AND id = ?');
  $st->execute([$fing, time(), $g['code'], $id]);
  if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];

  return ['ok' => true, 'id' => $id];
}

/* 1件取り出す（自分のアカウントのものだけ） */
function score_load(int $id): array {
  $g = score_open();
  if (!$g['ok']) return $g;

  $st = $g['db']->prepare('SELECT id, name, notes, data, fing, src FROM scores WHERE code = ? AND id = ?');
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
    /* 元のMIDI（base64）。MusicXML や大きすぎたものは null */
    'src'  => ($row['src'] === '') ? null : (string)$row['src'],
  ];
}

function score_delete(int $id): array {
  $g = score_open();
  if (!$g['ok']) return $g;

  $st = $g['db']->prepare('DELETE FROM scores WHERE code = ? AND id = ?');
  $st->execute([$g['code'], $id]);
  if ($st->rowCount() < 1) return ['ok' => false, 'error' => 'notfound'];

  return ['ok' => true, 'id' => $id];
}
