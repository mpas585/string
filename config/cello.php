<?php
/*
  config/cello.php — チェロの楽器定義。
  ここが楽器固有データの唯一の出所。includes/string_instrument.php が読み込み、
  JS 側（window.INSTRUMENT）へそのまま渡す。表示ラベルは includes/lang/*.php 側。

  元コードの対応箇所（src/util.js）:
    open / strnames  … OPEN = [36,43,50,57] / STRNAME = ['C','G','D','A']
    zones            … zoneOf()
    finger_table     … FINGER_TABLE
    max_off          … src/fingerboard.js の FB.maxOff
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

return [
  'id'       => 'cello',
  /* false の間は index.php が「準備中」ページを出す（アプリ本体は起動しない） */
  'ready'    => true,
  'emoji'    => '🎻',
  /* 入口ロゴ下の表示名（ブランド表記なので言語共通） */
  'title_en' => 'Cello Practice',
  /* ドロワー見出し */
  'label'    => 'Cello',

  /* 指板のポジション標識。'@xxx' は includes/lang/*.php の marker.xxx で置き換える */
  'markers' => [
    ['off'=>1,  'r'=>'½'],     ['off'=>2,  'r'=>'I'],    ['off'=>4,  'r'=>'II'],   ['off'=>5,  'r'=>'III'],
    ['off'=>7,  'r'=>'IV'],    ['off'=>9,  'r'=>'V'],    ['off'=>11, 'r'=>'VI'],   ['off'=>12, 'r'=>'8ve'],
    ['off'=>14, 'r'=>'@thumb'],['off'=>16, 'r'=>''],     ['off'=>19, 'r'=>'12th'], ['off'=>21, 'r'=>''],
    ['off'=>24, 'r'=>'15ma'],  ['off'=>26, 'r'=>''],     ['off'=>28, 'r'=>''],     ['off'=>29, 'r'=>'19th'],
  ],

  /* 開放弦 C2 G2 D3 A3（MIDIノート番号） */
  'open'     => [36, 43, 50, 57],
  'strnames' => ['C', 'G', 'D', 'A'],

  /* 指板に表示する開放弦からの半音数の上限（src/fingerboard.js FB.maxOff と同値） */
  'max_off'  => 30,

  /* 指板SVGの寸法（src/fingerboard.js の FB）。viewBox 352×1300 を基準にした座標（vbW=352 で板の左右余白が対称になる） */
  /* ネックとボディの接合部（開放弦からの半音数。src/fingerboard.js FB.bodyOff）。
     ネックストップ 280mm / 弦長 690mm = 0.4058 → off 9.01。
     ※ボディストップ400mmは駒側の寸法なので、ここに使うと接合部が下へずれる */
  'body_off' => 9,

  'board' => [
    'vbW'  => 352, 'vbH'  => 1300,
    'bx'   => 56,  'bw'   => 240,          /* 指板の左端と幅 */
    'strX' => [86, 146, 206, 266],         /* 各弦のX座標 */
    'strW' => [6.0, 4.8, 3.7, 2.7],        /* 各弦の描画太さ */
    'topY' => 64,  'botY' => 1250,
  ],

  /* スケール生成で扱う音域の上限（最高弦の開放から何半音上まで）。指板表示の max_off とは別物 */
  'scale_max_off' => 26,

  /* ポジション帯。key は言語ファイルの zone.* を引く。max_off=null は最後まで。
     klass は推奨ポジション（ロー/ミドル/ハイ）の判定に使う内部値なので変更しない。 */
  'zones' => [
    ['key' => 'open',       'max_off' => 0,    'klass' => 'low'],
    ['key' => 'low',        'max_off' => 7,    'klass' => 'low'],
    ['key' => 'mid',        'max_off' => 13,   'klass' => 'mid'],
    ['key' => 'high_thumb', 'max_off' => null, 'klass' => 'high'],
  ],

  /* 開放弦からの半音数 → 指番号の目安。数字以外は言語ファイルの finger.* を引く */
  'finger_table' => [
    0 => 'open', 1 => '1', 2 => '1', 3 => '2', 4 => '3', 5 => '4', 6 => '2',
    7 => '1', 8 => '1', 9 => '2', 10 => '3', 11 => '4', 12 => '1',
  ],
  /* テーブルに無い高音側（off>12）の表示 */
  'finger_high' => 'thumb',
];
