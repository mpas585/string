<?php
/*
  views/soon.php — 準備中の楽器（config/*.php の ready=false）で出すページ。
  呼び出し元: includes/string_instrument.php
  使う変数: $T $INST $INST_NAME $BASE $DEF $DEF_NAME $DEF_URL
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a1a2e">
<meta name="robots" content="noindex">
<title><?= h(t('soon.title', $INST_NAME)) ?></title>
<link rel="stylesheet" href="<?= h($BASE) ?>src/styles.css">
</head>
<body>
<div id="app">
<div class="picker" style="top:0">
  <div class="pk-logo"><?= h($INST['emoji']) ?></div>
  <div class="pk-title"><?= h($INST['title_en']) ?></div>
  <div class="pk-sub"><?= h(t('soon.title', $INST_NAME)) ?></div>
  <div class="drawer-note" style="max-width:400px; text-align:center"><?= h(t('soon.body')) ?></div>
  <a class="pk-card" href="<?= h($DEF_URL) ?>" style="text-decoration:none; margin-top:14px">
    <span class="pk-ic"><?= h($DEF['emoji']) ?></span><span class="pk-b"><?= h(t('soon.back', $DEF_NAME)) ?></span>
  </a>
</div>
</div>
</body>
</html>
