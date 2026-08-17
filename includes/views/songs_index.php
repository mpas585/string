<?php
/*
  views/songs_index.php — 曲一覧の紹介ページ。/{言語}/songs/
  呼び出し元: includes/songs.php
  使う変数: $T $SL $SONGS $LANG $LANG_URLS $HOME_URL $SONGS_HOME $songsBase
            $pick $levelName $rootPath $origin $JSON

  ・アセット（CSS・アイコン）は $rootPath からの絶対パスで出す。
    このページ自体は /{言語}/songs/ の2階層だが、曲詳細は /{言語}/songs/<id>/ の
    3階層に見えるため、相対（../）に頼ると両方で正しく張れない。絶対で統一する。
  ・掲載する曲は manifest.json そのまま。難易度（1..3）で束ねて並べる。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

$asset = function ($p) use ($rootPath) { return $rootPath . '/' . ltrim($p, '/'); };

/* 難易度ごとに束ねる（1..3、範囲外はその他としてまとめて最後に） */
$groups = [];
foreach ($SONGS as $s) {
  if (!isset($s['id']) || !preg_match('/^[A-Za-z0-9_-]+$/', $s['id'])) { continue; }
  $lv = (int)($s['level'] ?? 0);
  $groups[$lv][] = $s;
}
ksort($groups);

/* 構造化データ：曲の並び（ItemList）。各曲の詳細ページURLを指す */
$items = [];
$pos = 0;
foreach ($SONGS as $s) {
  if (!isset($s['id']) || !preg_match('/^[A-Za-z0-9_-]+$/', $s['id'])) { continue; }
  $pos++;
  $items[] = [
    '@type'    => 'ListItem',
    'position' => $pos,
    'name'     => $pick($s['title'] ?? $s['id']),
    'url'      => $origin . $songsBase($LANG) . $s['id'] . '/',
  ];
}
$ld = [
  '@context'        => 'https://schema.org',
  '@type'           => 'ItemList',
  'name'            => $SL['index_h1'],
  'itemListOrder'   => 'https://schema.org/ItemListOrderAscending',
  'numberOfItems'   => count($items),
  'itemListElement' => $items,
];
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>" class="home">
<head>
<?php require APP_ROOT . '/includes/views/analytics.php'; ?>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#15110c">
  <title><?= h($SL['index_title']) ?></title>
  <meta name="description" content="<?= h($SL['index_desc']) ?>">
  <link rel="canonical" href="<?= h($origin . $LANG_URLS[$LANG]) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_URLS[$l]) ?>">
<?php endforeach; ?>
  <link rel="alternate" hreflang="x-default" href="<?= h($origin . $LANG_URLS[APP_DEFAULT_LANG]) ?>">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="<?= h(APP_NAME) ?>">
  <meta property="og:title" content="<?= h($SL['index_h1']) ?>">
  <meta property="og:description" content="<?= h($SL['index_desc']) ?>">
  <meta property="og:url" content="<?= h($origin . $LANG_URLS[$LANG]) ?>">
  <meta property="og:image" content="<?= h($origin . $asset('public/icons/icon-512-v2.png')) ?>">

  <script type="application/ld+json">
<?= json_encode($ld, $JSON | JSON_PRETTY_PRINT) ?>
  </script>

  <link rel="icon" href="<?= h($asset('public/icons/favicon-32-v2.png')) ?>" sizes="32x32">
  <link rel="apple-touch-icon" href="<?= h($asset('public/icons/apple-touch-icon-v2.png')) ?>">
  <link rel="stylesheet" href="<?= h($asset('src/styles.css')) ?>">
</head>
<body class="home">
<main class="hm gd">
  <p class="gd-back"><a href="<?= h($HOME_URL) ?>"><?= h($SL['back_home']) ?></a></p>

  <header class="hm-head">
    <h1 class="hm-title"><?= h($SL['index_h1']) ?></h1>
    <p class="hm-sub"><?= h($SL['index_lead']) ?></p>
    <p class="gd-lead"><?= h(sprintf($SL['count_label'], count($items))) ?></p>
  </header>

<?php if (!$items): ?>
  <section class="gd-sec"><p><?= h(t('ui.songs_note')) ?></p></section>
<?php else: ?>
<?php foreach ($groups as $lv => $list): ?>
  <section class="gd-sec">
    <h2><?= h($SL['level_label']) ?><?= h($levelName($lv)) ?></h2>
    <nav class="hm-list">
<?php foreach ($list as $s):
        $id    = $s['id'];
        $title = $pick($s['title'] ?? $id);
        $desc  = $pick($s['desc']  ?? ''); ?>
      <a class="hm-card" href="<?= h($songsBase($LANG) . $id . '/') ?>">
        <span class="b"><?= h($title) ?><?php if ($desc !== ''): ?><small><?= h($desc) ?></small><?php endif; ?></span>
      </a>
<?php endforeach; ?>
    </nav>
  </section>
<?php endforeach; ?>
<?php endif; ?>

  <footer class="hm-foot">
    <div class="hm-lang">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
      <a<?= $l === $LANG ? ' class="on"' : '' ?> href="<?= h($LANG_URLS[$l]) ?>" hreflang="<?= h($l) ?>"><?= h($ln['name']) ?></a>
<?php endforeach; ?>
    </div>
    <small><a href="<?= h($rootPath) ?>/<?= h($LANG) ?>/terms/"><?= h(t('terms.link')) ?></a> &middot; &copy; <?= date('Y') ?> <?= h(APP_NAME) ?></small>
  </footer>
</main>
</body>
</html>
