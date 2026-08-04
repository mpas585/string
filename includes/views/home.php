<?php
/*
  views/home.php — 言語別トップ（楽器選択）。
  呼び出し元: /{言語}/index.php
  使う変数: $T $LANG $BASE $rootPath $origin $LANG_HOME_URLS
  ※ アプリ本体は /{言語}/{楽器}/（includes/views/app.php）。ここは入口だけ。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

/* 楽器カード。ready=false は「準備中」を出しつつリンクは張る（soon.php が受ける） */

/* このトップページに並べる順番。config/app.php の 'instruments' は
   アプリ全体の既定順（既定楽器や sitemap もこれを見る）なのでそちらは触らず、
   見せ方だけをここで決める。一覧に無いものは後ろへ回すので、
   config/app.php に楽器を足しただけでもカードは出る。 */
$HOME_ORDER = ['violin', 'viola', 'cello', 'contrabass'];
$ORDERED    = array_values(array_intersect($HOME_ORDER, APP_INSTRUMENTS));
foreach (APP_INSTRUMENTS as $ins) {
  if (!in_array($ins, $ORDERED, true)) { $ORDERED[] = $ins; }
}

$CARDS = [];
$LOGO  = '';
foreach ($ORDERED as $ins) {
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
  <meta property="og:image" content="<?= h($origin . $rootPath) ?>/public/icons/icon-512-v2.png">

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
  <link rel="icon" href="<?= h($BASE) ?>public/icons/favicon-32-v2.png" sizes="32x32">
  <link rel="apple-touch-icon" href="<?= h($BASE) ?>public/icons/apple-touch-icon-v2.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="<?= h(APP_NAME) ?>">

  <link rel="stylesheet" href="<?= h($BASE) ?>src/styles.css">

  <script>
    /* トップで使うのは保存番号まわりと PWA の案内だけなので、辞書は ui と save に絞って渡す
       （アプリ本体のページは includes/views/app.php が $T 全体を渡している） */
    window.APP = <?= json_encode(['lang' => $LANG, 'name' => APP_NAME], $JSON) ?>;
    window.T   = <?= json_encode(['ui' => $T['ui'], 'acc' => $T['acc']], $JSON) ?>;
  </script>
</head>
<body class="home">
<main class="hm">
  <!-- 設定の保存（アプリ本体では歯車のいちばん上。表示の書き換えは src/account.js） -->
  <div class="hm-acc">
    <span id="svWho" class="accwho"><?php e('ui.acc_none') ?></span>
    <button id="svBtn" class="ghost"><?php e('ui.acc_start') ?></button>
  </div>

  <header class="hm-head">
    <div class="hm-logo"><img src="<?= h($BASE) ?>public/icons/logo-v3.svg" alt="<?= h(APP_NAME) ?>" width="406" height="165" decoding="async"></div>
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
    <!-- ホーム画面に追加（対応ブラウザでのみ出る）。配線は src/pwa.js。要素IDはアプリ本体と共通 -->
    <div id="pwaBox" class="hm-pwa" hidden>
      <button id="pwaInstall" class="ghost"><?php e('ui.install') ?></button>
    </div>
    <div id="pwaNote" class="hm-pwa-note sub" hidden><?php e('ui.install_note') ?></div>

    <div class="hm-lang">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
      <a<?= $l === $LANG ? ' class="on"' : '' ?> href="<?= h($LANG_HOME_URLS[$l]) ?>" hreflang="<?= h($l) ?>"><?= h($ln['name']) ?></a>
<?php endforeach; ?>
    </div>
    <small><a href="<?= h($rootPath) ?>/<?= h($LANG) ?>/privacy/"><?php e('legal.link') ?></a> &middot; &copy; <?= date('Y') ?> <?= h(APP_NAME) ?></small>
  </footer>
</main>
<div id="dockScrim" class="dkscrim"></div>

<!-- アカウント（歯車の「アカウント」から開く）。出し分け・切替は src/account.js -->
<div id="mAcc" class="dkmodal acc" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_acc') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>

  <!-- ログインと新規登録の行き来。この2枚のときだけ出す（切替は src/account.js） -->
  <div id="acTabs" class="actabs" role="tablist">
    <button type="button" class="actab on" data-actab="signin" role="tab"><?php e('acc.tab_signin') ?></button>
    <button type="button" class="actab"    data-actab="signup" role="tab"><?php e('acc.tab_signup') ?></button>
  </div>

  <!-- ===== ログイン ===== -->
  <div class="acp on" data-acp="signin">
    <div class="fmrow">
      <label for="acEmail"><?php e('acc.email') ?></label>
      <input id="acEmail" type="email" inputmode="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="254">
    </div>
    <div class="fmrow">
      <label for="acPass"><?php e('acc.pass') ?></label>
      <div class="pwwrap">
        <input id="acPass" type="password" autocomplete="current-password" maxlength="200">
        <button type="button" class="pweye" data-pweye="acPass" aria-label="<?php e('acc.pw_show') ?>">👁</button>
      </div>
    </div>
    <div class="row controls">
      <button id="acLogin" class="primary" style="flex:1; justify-content:center"><?php e('acc.login') ?></button>
    </div>
    <div id="acResendRow" class="row controls" style="margin-top:8px" hidden>
      <button id="acResend" class="ghost" style="flex:1; justify-content:center"><?php e('acc.resend') ?></button>
    </div>
    <div class="acgoogle" hidden>
      <div class="acor"><?php e('acc.or') ?></div>
      <div class="row controls">
        <button id="acGoogle" class="ghost" style="flex:1; justify-content:center"><?php e('acc.google') ?></button>
      </div>
    </div>
    <div class="aclinks">
      <button type="button" id="acToForgot" class="aclink"><?php e('acc.to_forgot') ?></button>
    </div>
    <div class="sub"><?php e('acc.signin_note') ?></div>
  </div>

  <!-- ===== 新規登録 ===== -->
  <div class="acp" data-acp="signup">
    <div class="fmrow">
      <label for="acSuEmail"><?php e('acc.email') ?></label>
      <input id="acSuEmail" type="email" inputmode="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="254">
    </div>
    <div class="fmrow">
      <label for="acSuPass"><?php e('acc.pass_new') ?></label>
      <div class="pwwrap">
        <input id="acSuPass" type="password" autocomplete="new-password" minlength="8" maxlength="200">
        <button type="button" class="pweye" data-pweye="acSuPass" aria-label="<?php e('acc.pw_show') ?>">👁</button>
      </div>
    </div>
    <div class="sub"><?php e('acc.pass_rule', 8) ?></div>
    <div class="row controls">
      <button id="acSignup" class="primary" style="flex:1; justify-content:center"><?php e('acc.signup') ?></button>
    </div>
    <div class="acgoogle" hidden>
      <div class="acor"><?php e('acc.or') ?></div>
      <div class="row controls">
        <button id="acGoogleSu" class="ghost" style="flex:1; justify-content:center"><?php e('acc.google') ?></button>
      </div>
    </div>
    <div class="sub"><?php e('acc.signup_note') ?></div>
  </div>

  <!-- ===== パスワードを忘れた ===== -->
  <div class="acp" data-acp="forgot">
    <div class="sub"><?php e('acc.forgot_note') ?></div>
    <div class="fmrow">
      <label for="acFoEmail"><?php e('acc.email') ?></label>
      <input id="acFoEmail" type="email" inputmode="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="254">
    </div>
    <div class="row controls">
      <button id="acForgot" class="primary" style="flex:1; justify-content:center"><?php e('acc.forgot_send') ?></button>
    </div>
    <div class="aclinks">
      <button type="button" class="aclink" data-acback="signin">‹ <?php e('acc.to_signin') ?></button>
    </div>
  </div>

  <!-- ===== メールを送りました ===== -->
  <div class="acp" data-acp="sent">
    <div class="acsent">✉</div>
    <div class="sv-label"><span id="acSentTo"></span></div>
    <div class="sub"><?php e('acc.sent_note') ?></div>
    <div class="aclinks">
      <button type="button" class="aclink" data-acback="signin">‹ <?php e('acc.to_signin') ?></button>
    </div>
  </div>

  <!-- ===== ログイン中 ===== -->
  <div class="acp" data-acp="me">
    <div class="sv-label"><?php e('acc.signed_in') ?></div>
    <div id="acWho" class="sv-code acmail"></div>
    <div class="sub"><?php e('acc.me_note') ?></div>
    <hr class="sep">
    <div class="row controls">
      <button id="acToPasswd" class="ghost" style="flex:1; justify-content:center"><?php e('acc.passwd') ?></button>
    </div>
    <div class="row controls" style="margin-top:8px">
      <button id="acLogout" class="ghost" style="flex:1; justify-content:center"><?php e('acc.logout') ?></button>
    </div>
    <hr class="sep">
    <div class="row controls">
      <button id="acToDestroy" class="ghost danger" style="flex:1; justify-content:center"><?php e('acc.destroy') ?></button>
    </div>
  </div>

  <!-- ===== パスワードの変更 ===== -->
  <div class="acp" data-acp="passwd">
    <div id="acPwNowRow" class="fmrow" hidden>
      <label for="acPwNow"><?php e('acc.pass_now') ?></label>
      <div class="pwwrap">
        <input id="acPwNow" type="password" autocomplete="current-password" maxlength="200">
        <button type="button" class="pweye" data-pweye="acPwNow" aria-label="<?php e('acc.pw_show') ?>">👁</button>
      </div>
    </div>
    <div class="fmrow">
      <label for="acPwNext"><?php e('acc.pass_new') ?></label>
      <div class="pwwrap">
        <input id="acPwNext" type="password" autocomplete="new-password" minlength="8" maxlength="200">
        <button type="button" class="pweye" data-pweye="acPwNext" aria-label="<?php e('acc.pw_show') ?>">👁</button>
      </div>
    </div>
    <div class="sub"><?php e('acc.pass_rule', 8) ?></div>
    <div class="row controls">
      <button id="acPasswd" class="primary" style="flex:1; justify-content:center"><?php e('acc.passwd_do') ?></button>
    </div>
    <div class="aclinks">
      <button type="button" class="aclink" data-acback="me">‹ <?php e('acc.back') ?></button>
    </div>
    <div class="sub"><?php e('acc.passwd_note') ?></div>
  </div>

  <!-- ===== 退会 ===== -->
  <div class="acp" data-acp="destroy">
    <div class="sub"><?php e('acc.destroy_note') ?></div>
    <div id="acDelPassRow" class="fmrow" hidden>
      <label for="acDelPass"><?php e('acc.pass_now') ?></label>
      <div class="pwwrap">
        <input id="acDelPass" type="password" autocomplete="current-password" maxlength="200">
        <button type="button" class="pweye" data-pweye="acDelPass" aria-label="<?php e('acc.pw_show') ?>">👁</button>
      </div>
    </div>
    <div class="row controls">
      <button id="acDestroy" class="primary danger" style="flex:1; justify-content:center"><?php e('acc.destroy_do') ?></button>
    </div>
    <div class="aclinks">
      <button type="button" class="aclink" data-acback="me">‹ <?php e('acc.back') ?></button>
    </div>
  </div>

  <div id="acMsg" class="fmmsg" role="status"></div>
</div>

<!-- 保存が要る操作をしたときに出す（ログインしていないときだけ） -->
<div id="mAccAsk" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('acc.ask_title') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="sub sv-ask"><?php e('acc.ask_body') ?></div>
  <div class="startrow" style="margin-top:12px">
    <button id="acAskYes" class="primary"><?php e('acc.ask_yes') ?></button>
    <button id="acAskNo" class="ghost"><?php e('acc.ask_no') ?></button>
  </div>
</div>

<div id="toast"></div>

<script type="module" src="<?= h($BASE) ?>src/home.js"></script>
</body>
</html>
