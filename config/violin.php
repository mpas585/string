<?php
/*
  config/violin.php — バイオリン。中身（ポジション・指番号・指板寸法）は未定のため
  ready=false。この状態では index.php は「準備中」ページのみを出し、アプリ本体は起動しない。
  調弦だけ先に入れてある。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

return [
  'id'       => 'violin',
  'ready'    => false,
  'emoji'    => '🎻',
  'title_en' => 'Violin Practice',
  'label'    => 'Violin',

  /* TODO: ポジション標識は未確定（バイオリン系は親指ポジションが無く区切りも異なる） */
  'markers' => [
    ['off'=>2, 'r'=>'I'], ['off'=>5, 'r'=>'III'], ['off'=>7, 'r'=>'IV'],
    ['off'=>12,'r'=>'8ve'], ['off'=>24,'r'=>'15ma'],
  ],

  /* 開放弦 G3 D4 A4 E5 */
  'open'     => [55, 62, 69, 76],
  'strnames' => ['G', 'D', 'A', 'E'],

  /* TODO: 指板寸法（src/fingerboard.js の FB）をバイオリン用に決めてから見直す */
  'max_off'  => 24,

  /* TODO: 暫定でチェロと同じ寸法。実機に合わせて弦の太さ・間隔を見直すこと */
  'board' => [
    'vbW'  => 352, 'vbH'  => 1300,
    'bx'   => 56,  'bw'   => 240,
    'strX' => [86, 146, 206, 266],
    'strW' => [6.0, 4.8, 3.7, 2.7],
    'topY' => 64,  'botY' => 1250,
  ],

  /* TODO: 音域上限は未確定。ready=true にする前に必ず見直すこと */
  'scale_max_off' => 20,

  /* TODO: ポジション帯を要検討（チェロの親指ポジションに相当するものは無い） */
  'zones' => [
    ['key' => 'open', 'max_off' => 0,    'klass' => 'low'],
    ['key' => 'low',  'max_off' => 7,    'klass' => 'low'],
    ['key' => 'mid',  'max_off' => 12,   'klass' => 'mid'],
    ['key' => 'high', 'max_off' => null, 'klass' => 'high'],
  ],

  /* TODO: 運指テーブル未確定。ready=true にする前に必ず作り直すこと */
  'finger_table' => [
    0 => 'open', 1 => '1', 2 => '1', 3 => '2', 4 => '2', 5 => '3', 6 => '3',
    7 => '4', 8 => '1', 9 => '1', 10 => '2', 11 => '2', 12 => '3',
  ],
  'finger_high' => '4',
];
