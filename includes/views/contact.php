<?php
/*
  views/contact.php — お問い合わせ。/{言語}/contact/
  呼び出し元: includes/contact.php
  使う変数: $T $BASE $LANG $LANG_URLS $HOME_URL $rootPath $origin $JSON

  入力欄のIDはアプリ本体（includes/views/app.php の歯車の中）とそろえてある。
  送信先も同じ api/contact.php。動かすのは src/contact-page.js。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>" class="home">
<head>
<?php /* GA4 の計測タグ。測定IDは config/app.php の 'ga_id' 1か所だけ */ ?>
<?php require APP_ROOT . '/includes/views/analytics.php'; ?>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#15110c">
  <title><?php e('contact.page_title') ?></title>
  <meta name="description" content="<?= h(t('contact.page_desc')) ?>">
  <link rel="canonical" href="<?= h($origin . $LANG_URLS[$LANG]) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_URLS[$l]) ?>">
<?php endforeach; ?>

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="<?= h(APP_NAME) ?>">
  <meta property="og:title" content="<?= h(t('contact.page_h1')) ?>">
  <meta property="og:description" content="<?= h(t('contact.page_desc')) ?>">
  <meta property="og:url" content="<?= h($origin . $LANG_URLS[$LANG]) ?>">
  <meta property="og:image" content="<?= h($origin . $rootPath) ?>/public/icons/icon-512.png">

  <link rel="icon" href="<?= h($BASE) ?>public/icons/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="<?= h($BASE) ?>public/icons/apple-touch-icon.png">
  <link rel="stylesheet" href="<?= h($BASE) ?>src/styles.css">
</head>
<body class="home">
<main class="hm gd">
  <p class="gd-back"><a href="<?= h($HOME_URL) ?>"><?php e('contact.back') ?></a></p>

  <header class="hm-head">
    <h1 class="hm-title"><?php e('contact.page_h1') ?></h1>
    <p class="hm-sub"><?php e('contact.lead') ?></p>
  </header>

  <section class="gd-sec">
    <!-- 種別。「削除依頼」を選ぶと下の #ctTakedown が出る（切り替えは src/contact-page.js） -->
    <div class="fmrow">
      <label for="ctKind"><?php e('contact.kind') ?></label>
      <select id="ctKind">
        <option value="normal"><?php e('contact.kind_normal') ?></option>
        <option value="takedown"><?php e('contact.kind_takedown') ?></option>
      </select>
    </div>
    <div class="fmrow">
      <label for="ctName"><?php e('contact.name') ?></label>
      <input id="ctName" type="text" maxlength="60" autocomplete="name" placeholder="<?php e('contact.name_ph') ?>">
    </div>
    <div class="fmrow">
      <label for="ctMail"><?php e('contact.email') ?></label>
      <input id="ctMail" type="email" maxlength="120" autocomplete="email" placeholder="you@example.com">
    </div>

    <!-- 削除依頼のときだけ出す。ここに入れてもらえば十分（お名前と内容は任意）。
         送信されると api/contact.php が曲名の合うものを自動で非公開にする。 -->
    <div id="ctTakedown" hidden>
      <div class="sub"><?php e('contact.takedown_note') ?></div>
      <div class="fmrow">
        <label for="ctSong"><?php e('contact.song') ?></label>
        <input id="ctSong" type="text" maxlength="120" placeholder="<?php e('contact.song_ph') ?>">
      </div>
      <div class="fmrow">
        <label for="ctReason"><?php e('contact.reason') ?></label>
        <textarea id="ctReason" rows="3" maxlength="1000" placeholder="<?php e('contact.reason_ph') ?>"></textarea>
      </div>
    </div>

    <div class="fmrow">
      <label for="ctBody"><?php e('contact.body') ?></label>
      <textarea id="ctBody" rows="6" maxlength="4000" placeholder="<?php e('contact.body_ph') ?>"></textarea>
    </div>

    <!-- 罠の入力欄。人には見せない。埋まっていれば機械とみなす（判定は api/contact.php） -->
    <div class="hp" aria-hidden="true">
      <label for="ctSite">Website</label>
      <input id="ctSite" type="text" tabindex="-1" autocomplete="off">
    </div>

    <div class="startrow">
      <button id="ctSend" class="primary"><?php e('contact.send') ?></button>
    </div>
    <div id="ctMsg" class="fmmsg" role="status" aria-live="polite"></div>
    <div class="sub"><?php e('contact.note') ?></div>
  </section>

  <footer class="hm-foot">
    <div class="hm-lang">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
      <a<?= $l === $LANG ? ' class="on"' : '' ?> href="<?= h($LANG_URLS[$l]) ?>" hreflang="<?= h($l) ?>"><?= h($ln['name']) ?></a>
<?php endforeach; ?>
    </div>
    <small><a href="<?= h($rootPath) ?>/<?= h($LANG) ?>/privacy/"><?php e('legal.link') ?></a> &middot; <a href="<?= h($rootPath) ?>/<?= h($LANG) ?>/terms/"><?php e('terms.link') ?></a> &middot; &copy; <?= date('Y') ?> <?= h(APP_NAME) ?></small>
  </footer>
</main>

<script>
  /* 送信の処理で使う文言だけ渡す（このページは辞書全体を必要としない） */
  window.APP = { lang: <?= json_encode($LANG, $JSON) ?> };
  window.T   = { contact: <?= json_encode($T['contact'], $JSON) ?> };
</script>
<script type="module" src="<?= h($BASE) ?>src/contact-page.js"></script>
</body>
</html>
