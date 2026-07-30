<?php
/*
  manifest.php — PWA のマニフェスト（ホーム画面に保存したときのアプリ情報）。

  ページごとに start_url が変わるので静的ファイルにはできない。
    /ja/cello/   → manifest.php?lang=ja&inst=cello
    /ja/         → manifest.php?lang=ja
  scope は設置ディレクトリのルート。言語や楽器を跨いで移動してもアプリ内に留まる。

  ※ .htaccess で /manifest.webmanifest からも引ける（クエリはそのまま渡る）。
*/
define('STRING_APP', 1);
$APP  = require __DIR__ . '/config/app.php';

$lang = $_GET['lang'] ?? '';
if (!in_array($lang, $APP['langs'], true)) { $lang = $APP['default_lang']; }
$inst = $_GET['inst'] ?? '';
if (!in_array($inst, $APP['instruments'], true)) { $inst = ''; }

$T    = require __DIR__ . '/includes/lang/' . $lang . '.php';
$name = $APP['name'];
if ($inst !== '' && isset($T['instrument'][$inst])) { $name .= ' — ' . $T['instrument'][$inst]; }

$root  = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
$scope = $root . '/';
$start = $root . '/' . $lang . '/' . ($inst === '' ? '' : $inst . '/');

/* ホーム画面アイコンの長押しメニュー（公開済みの楽器へ直接入る） */
$shortcuts = [];
foreach ($APP['instruments'] as $i) {
  $c = require __DIR__ . '/config/' . $i . '.php';
  if (empty($c['ready'])) continue;
  $shortcuts[] = [
    'name' => $T['instrument'][$i] ?? $i,
    'url'  => $root . '/' . $lang . '/' . $i . '/',
    'icons' => [['src' => $root . '/public/icons/icon-192-v2.png', 'sizes' => '192x192', 'type' => 'image/png']],
  ];
}

$manifest = [
  'id'               => $scope,
  'name'             => $name,
  'short_name'       => $APP['name'],
  'description'      => $T['home']['desc'] ?? $name,
  'lang'             => $T['html_lang'],
  'dir'              => 'ltr',
  'start_url'        => $start,
  'scope'            => $scope,
  'display'          => 'standalone',
  'display_override' => ['standalone', 'minimal-ui'],
  'orientation'      => 'any',
  'background_color' => '#15110c',
  'theme_color'      => '#15110c',
  'categories'       => ['music', 'education'],
  'icons' => [
    ['src' => $root . '/public/icons/icon-192-v2.png',          'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
    ['src' => $root . '/public/icons/icon-512-v2.png',          'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
    ['src' => $root . '/public/icons/icon-maskable-192-v2.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'maskable'],
    ['src' => $root . '/public/icons/icon-maskable-512-v2.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
  ],
  'shortcuts' => $shortcuts,
];

header('Content-Type: application/manifest+json; charset=UTF-8');
header('Cache-Control: public, max-age=3600');
echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
