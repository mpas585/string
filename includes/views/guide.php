<?php
/*
  views/guide.php — お悩み集（アーカイブページ）。/{言語}/{楽器}/guide/
  呼び出し元: includes/string_guide.php
  使う変数: $T $INST $INST_NAME $BASE $LANG $LANG_URLS $APP_URL $rootPath $origin $JSON

  中身は includes/lang/*.php の 'guide' だけを見ている。
  記事を足すときは lang 側の guide.articles に配列を追加すればここは触らなくてよい。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

$ARTICLES = t('guide.articles');
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>" class="home">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#15110c">
  <title><?= h(t('guide.page_title', $INST_NAME)) ?></title>
  <meta name="description" content="<?= h(t('guide.page_desc', $INST_NAME)) ?>">
  <link rel="canonical" href="<?= h($origin . $LANG_URLS[$LANG]) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_URLS[$l]) ?>">
<?php endforeach; ?>

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="<?= h(APP_NAME) ?>">
  <meta property="og:title" content="<?= h(t('guide.page_h1', $INST_NAME)) ?>">
  <meta property="og:description" content="<?= h(t('guide.page_desc', $INST_NAME)) ?>">
  <meta property="og:url" content="<?= h($origin . $LANG_URLS[$LANG]) ?>">
  <meta property="og:image" content="<?= h($origin . $rootPath) ?>/public/icons/icon-512.png">

  <script type="application/ld+json">
<?php
  /* ページに出している Q&A をそのまま FAQPage にする（見えている内容と一致させる）。
     JSON_HEX_TAG は文言に < > が入っても </script> で抜けないようにするため。 */
  $faq = ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => []];
  foreach ($ARTICLES as $a) {
    foreach ($a[2] as $q) {
      $faq['mainEntity'][] = [
        '@type' => 'Question',
        'name'  => $q[0],
        'acceptedAnswer' => ['@type' => 'Answer', 'text' => $q[1]],
      ];
    }
  }
  echo json_encode($faq, $JSON | JSON_HEX_TAG | JSON_PRETTY_PRINT);
?>
  </script>

  <link rel="icon" href="<?= h($BASE) ?>public/icons/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="<?= h($BASE) ?>public/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="<?= h($BASE) ?>src/styles.css">
</head>
<body class="home">
<main class="hm gd">
  <p class="gd-back"><a href="<?= h($APP_URL) ?>"><?= h(t('guide.back', $INST_NAME)) ?></a></p>

  <header class="hm-head">
    <div class="hm-logo"><?= h($INST['emoji']) ?></div>
    <h1 class="hm-title"><?= h(t('guide.page_h1', $INST_NAME)) ?></h1>
    <p class="hm-sub"><?php e('guide.page_lead') ?></p>
  </header>

<?php foreach ($ARTICLES as $i => $a): ?>
  <section class="gd-sec">
    <h2><?= h($a[0]) ?></h2>
    <p class="gd-lead"><?= h($a[1]) ?></p>
<?php foreach ($a[2] as $q): ?>
    <details class="gq"<?= $i === 0 ? ' open' : '' ?>>
      <summary><?= h($q[0]) ?></summary>
      <p><?= h($q[1]) ?></p>
    </details>
<?php endforeach; ?>
  </section>
<?php endforeach; ?>

  <p class="gd-note"><?php e('guide.updated') ?></p>

  <footer class="hm-foot">
    <div class="hm-lang">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
      <a<?= $l === $LANG ? ' class="on"' : '' ?> href="<?= h($LANG_URLS[$l]) ?>" hreflang="<?= h($l) ?>"><?= h($ln['name']) ?></a>
<?php endforeach; ?>
    </div>
    <small><a href="<?= h($rootPath) ?>/<?= h($LANG) ?>/privacy/"><?php e('legal.link') ?></a> &middot; &copy; <?= date('Y') ?> <?= h(APP_NAME) ?></small>
  </footer>
</main>
</body>
</html>
