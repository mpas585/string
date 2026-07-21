<?php
/*
  fingering.php — ポジション帯（ゾーン）判定と指番号の目安。
  JS 側 src/util.js の zoneOf / fingerHint と同じ規則。
  ・境界と指番号テーブル＝楽器ごと（config/*.php）
  ・表示ラベル＝言語ごと（includes/lang/*.php）
  ここで両者を合成し、window.INSTRUMENT として JS へ渡す。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

/* config の zones にラベルを当てた配列を返す。
   [['maxOff'=>0,'zone'=>'開放','klass'=>'low'], ...] （maxOff=null は最後まで） */
function fingering_zones(array $inst, array $lang): array {
  $out = [];
  foreach (($inst['zones'] ?? []) as $z) {
    $key = $z['key'];
    $out[] = [
      'maxOff' => $z['max_off'],
      'zone'   => $lang['zone'][$key] ?? $key,
      'klass'  => $z['klass'],
    ];
  }
  return $out;
}

/* 開放弦からの半音数 → ['zone'=>ラベル, 'klass'=>low|mid|high] */
function fingering_zone_of(int $off, array $zones): array {
  foreach ($zones as $z) {
    if ($z['maxOff'] === null || $off <= $z['maxOff']) {
      return ['zone' => $z['zone'], 'klass' => $z['klass']];
    }
  }
  $last = end($zones);
  return $last ? ['zone' => $last['zone'], 'klass' => $last['klass']] : ['zone' => '', 'klass' => 'high'];
}

/* 指番号テーブル。数字はそのまま、それ以外（open / thumb など）は言語ファイルで置換 */
function fingering_table(array $inst, array $lang): array {
  $out = [];
  foreach (($inst['finger_table'] ?? []) as $off => $v) {
    $v = (string)$v;
    $out[(string)$off] = ctype_digit($v) ? $v : ($lang['finger'][$v] ?? $v);
  }
  return $out;
}

/* テーブルに無い高音側（チェロなら親指ポジション）の表示 */
function fingering_high(array $inst, array $lang): string {
  $v = (string)($inst['finger_high'] ?? '?');
  return ctype_digit($v) ? $v : ($lang['finger'][$v] ?? $v);
}

/* 開放弦からの半音数 → 指番号の目安（JS の fingerHint と同じ） */
function fingering_hint(int $off, array $table, string $high): string {
  $k = (string)$off;
  if (array_key_exists($k, $table)) return $table[$k];
  if ($off > 12) return $high;
  return '?';
}

/* JS へ渡す楽器定義（window.INSTRUMENT）を組み立てる */
function fingering_js_config(array $inst, array $lang): array {
  return [
    'id'          => $inst['id'],
    'open'        => array_map('intval', $inst['open']),
    'strnames'    => array_values($inst['strnames']),
    'maxOff'      => (int)$inst['max_off'],
    'scaleMaxOff' => (int)$inst['scale_max_off'],
    'board'       => $inst['board'],
    'zones'       => fingering_zones($inst, $lang),
    /* JS 側は数値キーで引くのでオブジェクトに固定する（配列化させない） */
    'fingerTable' => (object)fingering_table($inst, $lang),
    'fingerHigh'  => fingering_high($inst, $lang),
  ];
}
