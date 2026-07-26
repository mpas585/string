<?php
/*
  views/home.php — 言語別トップ（楽器選択）。
  呼び出し元: /{言語}/index.php
  使う変数: $T $LANG $BASE $rootPath $origin $LANG_HOME_URLS
  ※ アプリ本体は /{言語}/{楽器}/（includes/views/app.php）。ここは入口だけ。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

/* 楽器カード。ready=false は「準備中」を出しつつリンクは張る（soon.php が受ける） */
$CARDS = [];
$LOGO  = '';
foreach (APP_INSTRUMENTS as $ins) {
  $c = require APP_ROOT . '/config/' . $ins . '.php';
  $CARDS[] = ['id' => $ins, 'emoji' => $c['emoji'], 'ready' => !empty($c['ready'])];
  if ($ins === APP_DEFAULT_INSTRUMENT) { $LOGO = $c['emoji']; }
}
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>" class="home">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#15110c">
  <title><?php e('home.title') ?></title>
  <meta name="description" content="<?php e('home.desc') ?>">
  <link rel="canonical" href="<?= h($origin . $LANG_HOME_URLS[$LANG]) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_HOME_URLS[$l]) ?>">
<?php endforeach; ?>
  <link rel="alternate" hreflang="x-default" href="<?= h($origin . $rootPath . '/') ?>">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="<?= h(APP_NAME) ?>">
  <meta property="og:title" content="<?php e('home.title') ?>">
  <meta property="og:description" content="<?php e('home.desc') ?>">
  <meta property="og:url" content="<?= h($origin . $LANG_HOME_URLS[$LANG]) ?>">
  <meta property="og:image" content="<?= h($origin . $rootPath) ?>/public/icons/icon-512.png">

  <script type="application/ld+json">
<?php
  /* サイト全体の構造化データ。楽器ページ側は FAQPage を出しているのでここでは重複させない */
  echo json_encode([
    '@context' => 'https://schema.org',
    '@type'    => 'WebSite',
    'name'     => APP_NAME,
    'url'      => $origin . $LANG_HOME_URLS[$LANG],
    'inLanguage' => $T['html_lang'],
    'description' => t('home.desc'),
  ], $JSON | JSON_HEX_TAG | JSON_PRETTY_PRINT);
?>
  </script>

  <link rel="manifest" href="<?= h($BASE) ?>manifest.php?lang=<?= h($LANG) ?>">
  <link rel="icon" href="<?= h($BASE) ?>public/icons/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="<?= h($BASE) ?>public/icons/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="<?= h(APP_NAME) ?>">

  <link rel="stylesheet" href="<?= h($BASE) ?>src/styles.css">
</head>
<body class="home">
<main class="hm">
  <header class="hm-head">
    <div class="hm-logo"><?= h($LOGO) ?></div>
    <h1 class="hm-title"><?= h(APP_NAME) ?></h1>
    <p class="hm-sub"><?php e('home.sub') ?></p>
  </header>

  <h2 class="hm-h"><?php e('home.choose') ?></h2>
  <nav class="hm-list">
<?php foreach ($CARDS as $c): ?>
    <a class="hm-card<?= $c['ready'] ? '' : ' soon' ?>" href="<?= h($rootPath . '/' . $LANG . '/' . $c['id'] . '/') ?>">
      <span class="ic"><?= h($c['emoji']) ?></span>
      <span class="b"><?= h(t('instrument.' . $c['id'])) ?><small><?php if ($c['ready']): ?><?php e('home.card_note') ?><?php else: ?><?php e('ui.inst_soon') ?><?php endif; ?></small></span>
      <span class="cv">›</span>
    </a>
<?php endforeach; ?>
  </nav>

  <section class="hm-about">
    <h2><?php e('home.about_t') ?></h2>
    <p><?php e('home.about') ?></p>
  </section>

  <footer class="hm-foot">
    <div class="hm-lang">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
      <a<?= $l === $LANG ? ' class="on"' : '' ?> href="<?= h($LANG_HOME_URLS[$l]) ?>" hreflang="<?= h($l) ?>"><?= h($ln['name']) ?></a>
<?php endforeach; ?>
    </div>
    <small>&copy; <?= date('Y') ?> <?= h(APP_NAME) ?></small>
  </footer>
</main>
<script type="module" src="<?= h($BASE) ?>src/pwa.js"></script>
</body>
</html>
