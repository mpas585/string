<?php
/*
  views/songs_detail.php — 1曲の紹介ページ。/{言語}/songs/<曲id>/
  呼び出し元: includes/songs.php（$song が入っているとき）
  使う変数: $song $reqId $T $SL $LANG $LANG_URLS $HOME_URL $SONGS_HOME
            $pick $levelName $rootPath $origin $JSON

  ・「この曲を◯◯で練習する」の各ボタンは /{言語}/{楽器}/?song=<曲id> を指す。
    アプリ側（src/main.js）が ?song= を見て、入口を飛ばしてその曲を開く。
  ・アセットは $rootPath からの絶対パス（このページは見かけ上3階層なので相対に頼らない）。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

$asset = function ($p) use ($rootPath) { return $rootPath . '/' . ltrim($p, '/'); };

$id    = $reqId;
$title = $pick($song['title'] ?? $id);
$desc  = $pick($song['desc']  ?? '');
$lv    = (int)($song['level'] ?? 0);
$lvNm  = $levelName($lv);

$canon    = $origin . $LANG_URLS[$LANG];
$titleTag = sprintf($SL['song_title'], $title);
$descTag  = sprintf($SL['song_desc'], $title, ($desc !== '' ? $desc : $title));

/* 構造化データ：曲そのもの（MusicComposition）＋パンくず（BreadcrumbList） */
$ld = ['@context' => 'https://schema.org', '@graph' => [
  [
    '@type'              => 'MusicComposition',
    'name'               => $title,
    'url'                => $canon,
    'inLanguage'         => $T['html_lang'],
    'isAccessibleForFree'=> true,
  ],
  [
    '@type'           => 'BreadcrumbList',
    'itemListElement' => [
      ['@type' => 'ListItem', 'position' => 1, 'name' => $SL['crumb_home'],  'item' => $origin . $HOME_URL],
      ['@type' => 'ListItem', 'position' => 2, 'name' => $SL['crumb_songs'], 'item' => $origin . $SONGS_HOME],
      ['@type' => 'ListItem', 'position' => 3, 'name' => $title,             'item' => $canon],
    ],
  ],
]];
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>" class="home">
<head>
<?php require APP_ROOT . '/includes/views/analytics.php'; ?>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#15110c">
  <title><?= h($titleTag) ?></title>
  <meta name="description" content="<?= h($descTag) ?>">
  <link rel="canonical" href="<?= h($canon) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_URLS[$l]) ?>">
<?php endforeach; ?>
  <link rel="alternate" hreflang="x-default" href="<?= h($origin . $LANG_URLS[APP_DEFAULT_LANG]) ?>">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="<?= h(APP_NAME) ?>">
  <meta property="og:title" content="<?= h($title) ?>">
  <meta property="og:description" content="<?= h($descTag) ?>">
  <meta property="og:url" content="<?= h($canon) ?>">
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
  <p class="gd-back"><a href="<?= h($SONGS_HOME) ?>"><?= h($SL['to_list']) ?></a></p>

  <header class="hm-head">
    <h1 class="hm-title"><?= h($title) ?></h1>
<?php if ($desc !== ''): ?>
    <p class="hm-sub"><?= h($desc) ?></p>
<?php endif; ?>
    <p class="gd-lead"><?= h($SL['level_label']) ?><?= h($lvNm) ?></p>
  </header>

  <section class="gd-sec">
    <h2><?= h($SL['about_h']) ?></h2>
    <p><?= h($SL['about_p']) ?></p>
  </section>

  <section class="gd-sec">
    <h2><?= h($SL['choose_inst_h']) ?></h2>
    <nav class="hm-list">
<?php foreach (APP_INSTRUMENTS as $inst):
        $iname = t('instrument.' . $inst);
        $iurl  = $rootPath . '/' . $LANG . '/' . $inst . '/?song=' . rawurlencode($id); ?>
      <a class="hm-card" href="<?= h($iurl) ?>">
        <span class="ic"><img src="<?= h($asset('public/instruments/' . $inst . '.png')) ?>" alt="" width="40" height="40" decoding="async" loading="lazy"></span>
        <span class="b"><?= h(sprintf($SL['practice_on'], $iname)) ?><small><?= h($SL['practice_cta_sub']) ?></small></span>
      </a>
<?php endforeach; ?>
    </nav>
  </section>

  <p class="gd-note"><a href="<?= h($SONGS_HOME) ?>"><?= h($SL['all_songs']) ?></a></p>

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
