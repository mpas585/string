<?php
/*
  views/terms.php — 利用規約。/{言語}/terms/
  呼び出し元: includes/terms.php
  使う変数: $T $BASE $LANG $LANG_URLS $HOME_URL $rootPath $origin

  中身は includes/lang/*.php の 'terms' だけを見ている。
  条は terms.sections の配列そのままで、1件は次の形:
      [見出し, [段落, 段落, …], アンカーid（省略可）]
  アンカーidを付けた条は /{言語}/terms/#（id） で直接開ける。
  楽譜の投稿（共有）についての条には post を付けてある。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

$SECS = t('terms.sections');
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>" class="home">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#15110c">
  <title><?php e('terms.page_title') ?></title>
  <meta name="description" content="<?= h(t('terms.page_desc')) ?>">
  <link rel="canonical" href="<?= h($origin . $LANG_URLS[$LANG]) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_URLS[$l]) ?>">
<?php endforeach; ?>

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="<?= h(APP_NAME) ?>">
  <meta property="og:title" content="<?= h(t('terms.page_h1')) ?>">
  <meta property="og:description" content="<?= h(t('terms.page_desc')) ?>">
  <meta property="og:url" content="<?= h($origin . $LANG_URLS[$LANG]) ?>">
  <meta property="og:image" content="<?= h($origin . $rootPath) ?>/public/icons/icon-512.png">

  <link rel="icon" href="<?= h($BASE) ?>public/icons/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="<?= h($BASE) ?>public/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="<?= h($BASE) ?>src/styles.css">
</head>
<body class="home">
<main class="hm gd">
  <p class="gd-back"><a href="<?= h($HOME_URL) ?>"><?php e('terms.back') ?></a></p>

  <header class="hm-head">
    <h1 class="hm-title"><?php e('terms.page_h1') ?></h1>
    <p class="hm-sub"><?php e('terms.lead') ?></p>
  </header>

<?php foreach ($SECS as $i => $s):
        $id = (isset($s[2]) && $s[2] !== '') ? $s[2] : ('sec' . ($i + 1)); ?>
  <section class="gd-sec" id="<?= h($id) ?>">
    <h2><?= h($s[0]) ?></h2>
<?php foreach ($s[1] as $p): ?>
    <p><?= h($p) ?></p>
<?php endforeach; ?>
  </section>
<?php endforeach; ?>

  <p class="gd-note"><?php e('terms.updated') ?></p>

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
