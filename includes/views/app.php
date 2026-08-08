<?php
/*
  views/app.php — アプリ本体のHTMLシェル（元 index.html）。
  呼び出し元: includes/string_instrument.php
  使う変数: $T $INST $INST_NAME $BASE $LANG $LANG_URLS $origin
            $NOTE_NAMES $OPEN_LABELS $JS_APP $JS_INSTRUMENT $JSON
  ※ id / class は src/*.js が参照している。変更するときは JS 側も確認すること。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }
?>
<!doctype html>
<html lang="<?= h($T['html_lang']) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#15110c">
  <title><?= h(t('page_title', $INST_NAME)) ?></title>
  <meta name="description" content="<?= h(t('intro.lead', $INST_NAME)) ?>">
  <link rel="canonical" href="<?= h($origin . $LANG_URLS[$LANG]) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_URLS[$l]) ?>">
<?php endforeach; ?>
<?php /* x-default（言語中立URL）は楽器選択トップ /{言語}/ 側で出す。ここでは同じ楽器の各言語版だけを示す */ ?>

  <script type="application/ld+json">
<?php
  /* FAQ の構造化データ。文言は includes/lang/*.php の intro.faqs と同じものを使う
     （画面に見えている内容と一致していることが要件）。
     JSON_HEX_TAG は文言に < > が入っても </script> で抜けないようにするため。 */
  $faq = ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => []];
  /* 「よくある質問」＋その下の「お悩みガイド」。どちらも画面に見えている内容 */
  foreach (array_merge(t('intro.faqs'), t('guide.faqs')) as $q) {
    $faq['mainEntity'][] = [
      '@type' => 'Question',
      'name'  => $q[0],
      'acceptedAnswer' => ['@type' => 'Answer', 'text' => $q[1]],
    ];
  }
  echo json_encode($faq, $JSON | JSON_HEX_TAG | JSON_PRETTY_PRINT);
?>
  </script>

  <!-- ホーム画面に保存したときにアプリとして起動するための情報（manifest.php が言語・楽器ごとに生成） -->
  <link rel="manifest" href="<?= h($BASE) ?>manifest.php?lang=<?= h($LANG) ?>&amp;inst=<?= h($INSTRUMENT) ?>">
  <link rel="icon" href="<?= h($BASE) ?>public/icons/favicon-32-v2.png" sizes="32x32">
  <link rel="apple-touch-icon" href="<?= h($BASE) ?>public/icons/apple-touch-icon-v2.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="<?= h(APP_NAME) ?>">

  <link rel="stylesheet" href="<?= h($BASE) ?>src/styles.css">
  <script>
  /* PHP から JS への受け渡し（src/util.js が window.INSTRUMENT を読む） */
  window.APP = <?= json_encode($JS_APP, $JSON) ?>;
  window.INSTRUMENT = <?= json_encode($JS_INSTRUMENT, $JSON) ?>;
  /* 文言辞書（includes/lang/{言語}.php と同一。JS側の文言もここから引く） */
  window.T = <?= json_encode($T, $JSON) ?>;
  </script>
</head>
<body>
<div id="app">
<div class="topbar">
  <button id="menu" class="iconbtn" aria-label="<?php e('ui.menu') ?>">☰</button>
  <!-- 上部バーはいま開いている譜面の名前だけを出す（src/modes.js の renderScoreTitle）。
       押さえる音の情報は指板の上に出ているので、ここでは重ねない。
       自分がアップロードした譜面のときだけ押せるようになり、その場で名前を変えられる
       （出し入れは src/uploads.js の syncShareDeleteBtns、変更は openRename）。 -->
  <button id="scoretitle" class="scoretitle" type="button" disabled></button>
  <button id="gear" class="iconbtn" aria-label="<?php e('ui.gear_aria') ?>">⚙</button>
</div>

<!-- 全画面 指板 -->
<div class="board-full">
  <!-- 公開/非公開（左上・ハートの上）。自分がアップロードした譜面を開いているときだけ出る。
       出し入れと文言の切り替えは src/uploads.js の syncShareDeleteBtns。公開中は青くなる。 -->
  <button id="shareBtn" class="sharebtn" hidden aria-pressed="false" aria-label="<?php e('ui.share_btn_private') ?>">
    <span class="sb-ic" aria-hidden="true">🔗</span><span class="sb-t"><?php e('ui.share_btn_private') ?></span>
  </button>
  <!-- お気に入り。曲を読み込んでいるときだけ出る（出し入れは src/favorites.js の syncFavBtn）。
       .fab と同じく位置は画面に対して固定なので、指板を動かしても左上に残る。 -->
  <button id="favBtn" class="favbtn" hidden aria-pressed="false" aria-label="<?php e('ui.fav_add') ?>">♡</button>
  <!-- アップロードした譜面の削除（右上）。自分の譜面を開いているときだけ出る -->
  <!-- 絵文字の🗑は小さく潰れて何のアイコンか分からないので、線画のSVGにしてある -->
  <button id="delBtn" class="delbtn" hidden aria-label="<?php e('ui.uploads_delete') ?>" title="<?php e('ui.uploads_delete') ?>">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 6.5h16"/>
      <path d="M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7"/>
      <path d="M6.4 6.5l.8 12.1a1.6 1.6 0 0 0 1.6 1.5h6.4a1.6 1.6 0 0 0 1.6-1.5l.8-12.1"/>
      <path d="M10.2 10.3v6.2M13.8 10.3v6.2"/>
    </svg>
  </button>
  <div id="fbsvg" class="fbsvg"></div>
  <div id="staffview" class="staffview"></div>
</div>

<!-- 歯車：指板の表示設定 -->
<div id="gearScrim" class="gscrim"></div>
<div id="gearPanel" class="gearpanel">
  <div class="gp-head">
    <span class="gp-tt"><?php e('ui.settings') ?></span>
    <button id="gearClose" class="iconbtn" aria-label="<?php e('ui.close') ?>">✕</button>
  </div>

  <!-- ===== 一覧（メイン）=====
       行数の多い項目（指板ズーム・音量）は行にして、押したらサブメニューへ差し替える。
       表示するページは常に1枚だけ（.gp-page.on）。切替は src/drawer.js の openGearPage()。 -->
  <div class="gp-page on" data-gp="main">

    <!-- ===== アカウント（いちばん上）=====
         メールアドレス＋パスワードのログイン。表示は src/account.js がサーバに聞いて書き換える。
         PHP 側では何も出さない（ページをキャッシュ可能なままにしておくため）。 -->
    <div class="gp-t"><?php e('ui.acc') ?></div>
    <div id="svWho" class="accwho"><?php e('ui.acc_none') ?></div>
    <div class="row controls">
      <button id="svBtn" class="ghost"><?php e('ui.acc_start') ?></button>
    </div>
    <!-- 累計練習時間。数字は src/practice-ui.js が入れる。押すとカレンダーが開く -->
    <button type="button" id="pracBtn" class="pracline">
      <span class="pl-l">💮 <?php e('prac.total') ?></span>
      <span id="pracTotal" class="pl-v">–</span>
    </button>
    <hr class="sep">

    <!-- 表示（指板/五線譜・フレット線・横画面・指板ズーム）はサブメニューへ。
         右端の値は src/drawer.js の syncSettingsUI() が書き換える -->
    <button class="gp-row" data-gpopen="view">
      <span><?php e('ui.view') ?></span><span class="v" id="viewRowV"></span><span class="cv">›</span>
    </button>

    <!-- 開始カウント（ON/OFF と 4 / 8）もサブメニューへ。右端の値は syncCountSeg() が書き換える -->
    <button class="gp-row" data-gpopen="count">
      <span><?php e('ui.countin') ?></span><span class="v" id="countRowV"></span><span class="cv">›</span>
    </button>
    <!-- サブメニューへ。右端の値は syncVolRow() が書き換える -->
    <button class="gp-row" data-gpopen="vol">
      <span><?php e('ui.volume') ?></span><span class="v" id="volRowV">70%</span><span class="cv">›</span>
    </button>

    <div id="awakeSw" class="sw on"><span><?php e('ui.keepawake') ?></span><span class="knob"></span></div>
    <!-- 軽量モード：軽いMIDI音源に切り替える（音が途切れる端末むけ） -->
    <div id="liteSw" class="sw"><span><?php e('ui.lite') ?></span><span class="knob"></span></div>
    <div class="sub" style="margin:-3px 0 8px"><?php e('ui.lite_note') ?></div>

    <!-- ===== ホーム画面に追加（対応ブラウザでのみ出る）=====
         ほかの項目（表示・開始カウント・音量・言語）と同じく、行を押して
         サブメニューへ差し替える。行の出し入れは src/pwa.js の syncRow() -->
    <hr class="sep">
    <div id="pwaRow" hidden>
      <button class="gp-row" data-gpopen="pwa">
        <span><?php e('ui.install') ?></span><span class="cv">›</span>
      </button>
    </div>

    <!-- ===== 言語 =====
         行数のある項目は行にして、押したらサブメニューへ差し替える（表示・音量と同じ作法）。
         右端の値は src/drawer.js の syncSettingsUI() が書き換える。
         「ホーム画面に追加」とのあいだの区切り線は置かない（続きの行として詰める） -->
    <button class="gp-row" data-gpopen="lang">
      <span><?php e('ui.lang_label') ?></span><span class="v" id="langRowV"></span><span class="cv">›</span>
    </button>

    <!-- ===== 共有曲の管理（マスターアカウントだけ）=====
         既定では隠しておき、管理者でログインしたときだけ src/account.js が出す。
         中身（一覧の描画・公開/非公開・削除）は src/shares.js。
         ※ 見えるかどうかとは別に、サーバ側（api/shares.php）でも必ず管理者か確かめている。 -->
    <button class="gp-row" id="admRow" data-gpopen="admin" hidden>
      <span><?php e('share.admin') ?></span><span class="cv">›</span>
    </button>

    <!-- ===== お問い合わせ（いちばん下）=====
         こちらもサブメニュー。開くのは src/contact.js の openContact()
         （入力欄の初期化と焦点合わせがあるので data-gpopen ではなく ID で配線する） -->
    <button class="gp-row" id="contactBtn">
      <span><?php e('ui.contact') ?></span><span class="cv">›</span>
    </button>
  </div>

  <!-- ===== サブ：表示（指板/五線譜・フレット線・横画面・指板ズーム） ===== -->
  <div class="gp-page" data-gp="view">
    <div class="gp-back">
      <button type="button" data-gpback>‹ <?php e('ui.back') ?></button>
      <span class="t"><?php e('ui.view') ?></span>
    </div>
    <div class="seg2" id="viewSeg">
      <button data-view="board"><?php e('ui.view_board') ?></button>
      <button data-view="staff"><?php e('ui.view_staff') ?></button>
    </div>
    <div id="fretSw" class="sw on"><span><?php e('ui.frets') ?></span><span class="knob"></span></div>
    <div id="landSw" class="sw"><span><?php e('ui.landscape') ?></span><span class="knob"></span></div>
    <div class="sub" style="margin:-3px 0 8px"><?php e('ui.landscape_note') ?></div>

    <!-- 指板ズームは「指板」を選んでいるときだけ出す（五線譜では効かないため）。
         出し入れは src/drawer.js の syncSettingsUI() -->
    <div id="zoomBox" hidden>
      <hr class="sep">
      <div class="gp-t"><?php e('ui.zoom') ?></div>
      <div class="field">
        <div class="k"><?php e('ui.zoom_k') ?></div>
        <div class="v tempo">
          <input id="zoom" type="range" min="20" max="220" step="5" value="100">
          <b id="zoomval">100%</b>
        </div>
      </div>
      <div class="row controls">
        <button id="zoomOut" class="ghost">−</button>
        <button id="zoomIn" class="ghost">＋</button>
        <button id="zoomFit" class="ghost"><?php e('ui.zoom_fit') ?></button>
        <button id="zoomReset" class="ghost"><?php e('ui.zoom_reset') ?></button>
      </div>
    </div>
  </div>

  <!-- ===== サブ：開始カウント ===== -->
  <div class="gp-page" data-gp="count">
    <div class="gp-back">
      <button type="button" data-gpback>‹ <?php e('ui.back') ?></button>
      <span class="t"><?php e('ui.countin') ?></span>
    </div>
    <div id="countSw" class="sw on"><span><?php e('ui.countin') ?></span><span class="knob"></span></div>
    <div class="seg2" id="countSeg">
      <button data-count="4"><?php e('ui.countin_4') ?></button>
      <button data-count="8"><?php e('ui.countin_8') ?></button>
    </div>
  </div>

  <!-- ===== サブ：音量 ===== -->
  <div class="gp-page" data-gp="vol">
    <div class="gp-back">
      <button type="button" data-gpback>‹ <?php e('ui.back') ?></button>
      <span class="t"><?php e('ui.volume') ?></span>
    </div>
    <div class="vol"><span><?php e('ui.vol_master') ?></span><input id="volMaster" type="range" min="0" max="100" value="70"><b id="volMasterV">70</b></div>
    <div class="vol"><span><?php e('ui.vol_lead') ?></span><input id="volLead" type="range" min="0" max="100" value="80"><b id="volLeadV">80</b></div>
    <div class="vol"><span><?php e('ui.vol_drum') ?></span><input id="volDrum" type="range" min="0" max="100" value="70"><b id="volDrumV">70</b></div>
    <div class="vol"><span><?php e('ui.vol_bass') ?></span><input id="volBass" type="range" min="0" max="100" value="70"><b id="volBassV">70</b></div>
    <div class="vol"><span><?php e('ui.vol_chord') ?></span><input id="volChord" type="range" min="0" max="100" value="60"><b id="volChordV">60</b></div>
    <div class="vol"><span><?php e('ui.vol_metro') ?></span><input id="volMetro" type="range" min="0" max="100" value="60"><b id="volMetroV">60</b></div>
    <div class="row controls" style="margin-top:8px">
      <button id="volReset" class="ghost" style="flex:1; justify-content:center"><?php e('ui.vol_reset') ?></button>
    </div>
  </div>

  <!-- ===== サブ：ホーム画面に追加 =====
       もとは一覧に直接置いていたボタンと案内文を、そのままこの面へ移した。
       id は変えていないので src/pwa.js の処理はこれまでどおり。 -->
  <div class="gp-page" data-gp="pwa">
    <div class="gp-back">
      <button type="button" data-gpback>‹ <?php e('ui.back') ?></button>
      <span class="t"><?php e('ui.install') ?></span>
    </div>
    <div id="pwaBox" class="row controls" hidden>
      <button id="pwaInstall" class="ghost" style="flex:1; justify-content:center"><?php e('ui.install') ?></button>
    </div>
    <div id="pwaNote" class="sub" hidden><?php e('ui.install_note') ?></div>
  </div>

  <!-- ===== サブ：言語 ===== -->
  <div class="gp-page" data-gp="lang">
    <div class="gp-back">
      <button type="button" data-gpback>‹ <?php e('ui.back') ?></button>
      <span class="t"><?php e('ui.lang_label') ?></span>
    </div>
    <select id="langSel">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
      <option value="<?= h($l) ?>"<?= $l === $LANG ? ' selected' : '' ?>><?= h($ln['name']) ?></option>
<?php endforeach; ?>
    </select>
    <div class="sub" style="margin:6px 0 10px"><?php e('ui.lang_note') ?></div>
  </div>

  <!-- ===== サブ：お問い合わせ =====
       もとはドックのモーダル（#mContact）だったものを、そのままこの面へ移した。
       入力欄のIDは変えていないので src/contact.js の送信処理はこれまでどおり。 -->
  <div class="gp-page" data-gp="contact">
    <div class="gp-back">
      <button type="button" data-gpback>‹ <?php e('ui.back') ?></button>
      <span class="t"><?php e('ui.m_contact') ?></span>
    </div>
    <!-- 種別。「削除依頼」を選ぶと下の #ctTakedown が出る（切り替えは src/contact.js） -->
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
      <textarea id="ctBody" rows="5" maxlength="4000" placeholder="<?php e('contact.body_ph') ?>"></textarea>
    </div>
    <!-- 罠フィールド：人には見えない。埋まっていれば機械なので送信しない -->
    <div class="hp" aria-hidden="true"><label for="ctSite">website</label><input id="ctSite" type="text" tabindex="-1" autocomplete="off"></div>
    <div class="row controls">
      <button id="ctSend" class="primary" style="flex:1; justify-content:center"><?php e('contact.send') ?></button>
    </div>
    <div id="ctMsg" class="fmmsg" role="status"></div>
    <div class="sub"><?php e('contact.note') ?></div>
  </div>

  <!-- ===== サブ：共有曲の管理（マスターアカウントだけ）=====
       一覧・絞り込み・ページ送りの中身は src/shares.js が入れる。PHP 側では枠だけ出す。 -->
  <div class="gp-page" data-gp="admin">
    <div class="gp-back">
      <button type="button" data-gpback>‹ <?php e('ui.back') ?></button>
      <span class="t"><?php e('share.admin') ?></span>
    </div>
    <div class="songfind">
      <input id="admQ" type="search" maxlength="60" autocomplete="off" placeholder="<?php e('share.find_ph') ?>">
    </div>
    <div id="admList" class="uplist"></div>
    <div id="admPager" class="pager" hidden></div>
    <div class="sub"><?php e('share.admin_note') ?></div>
  </div>
</div>

<div id="empty" class="empty">
  <b><?php e('ui.empty_t') ?></b>
  <div><span class="kbd">☰</span> <?php e('ui.empty_s') ?></div>
</div>

<!-- 下部トランスポート：運指リスト（横スクロール）＋ 再生メーター -->
<div id="transport" class="transport">
  <div id="strip" class="strip"></div>
  <div class="seekrow">
    <span id="tmCur" class="tm">1</span>
    <div id="seek" class="seek">
      <div class="trk">
        <div id="seekLoop" class="loopband"></div>
        <div id="seekFill" class="fill"></div>
      </div>
      <div id="seekHead" class="head"></div>
    </div>
    <span id="tmTotal" class="tm r">/ 1</span>
  </div>
</div>

<!-- 入口：モード選択 ＋ 説明 -->
<div id="picker" class="picker">
  <div class="pk-logo"><img src="<?= h($BASE) ?>public/icons/logo-v3.svg" alt="<?= h(APP_NAME) ?>" width="406" height="165" decoding="async"></div>
  <h1 class="pk-title"><?= h(APP_NAME) ?></h1>
  <div class="pk-sub"><?php e('app_sub', $INST_NAME) ?></div>
  <button class="pk-card pk-main" data-mode="score">
    <span class="pk-ic">🎼</span><span class="pk-b"><?php e('ui.mode_score') ?><small><?php e('ui.mode_score_s') ?></small></span>
  </button>
  <button class="pk-card" data-mode="game">
    <span class="pk-ic">🎮</span><span class="pk-b"><span class="pk-b-title"><?php e('ui.mode_game') ?><span class="beta-badge">β</span></span><small><?php e('ui.mode_game_s') ?></small></span>
  </button>
  <button class="pk-card" data-mode="tuner">
    <span class="pk-ic">🎯</span><span class="pk-b"><?php e('ui.mode_tuner') ?><small><?php e('ui.mode_tuner_s') ?></small></span>
  </button>

  <!-- 説明（モード選択の下） -->
  <section class="pk-desc">
    <h2><?php e('intro.title') ?></h2>
    <p><?php e('intro.lead', $INST_NAME) ?></p>
    <dl>
<?php foreach (t('intro.items') as $it): ?>
      <dt><span><?= h($it[0]) ?></span><?= h($it[1]) ?></dt>
      <dd><?= h($it[2]) ?></dd>
<?php endforeach; ?>
    </dl>
    <p class="pk-desc-note"><?php e('intro.note') ?></p>

    <h2><?php e('intro.feat_title') ?></h2>
    <ul class="pk-feat">
<?php foreach (t('intro.feats') as $f): ?>
      <li><?= h($f) ?></li>
<?php endforeach; ?>
    </ul>

    <h2><?php e('intro.use_title') ?></h2>
    <ol class="pk-steps">
<?php foreach (t('intro.steps') as $st): ?>
      <li><?= h($st) ?></li>
<?php endforeach; ?>
    </ol>

    <h2><?php e('intro.faq_title') ?></h2>
    <dl class="pk-faq">
<?php foreach (t('intro.faqs') as $q): ?>
      <dt><?= h($q[0]) ?></dt>
      <dd><?= h($q[1]) ?></dd>
<?php endforeach; ?>
    </dl>

    <!-- ===== お悩みガイド（記事への導線）=====
         Q&A は <details>/<summary> の開閉なので JS は要らない。
         文言は includes/lang/*.php の guide.*、記事一覧は /{言語}/{楽器}/guide/。 -->
    <h2 id="guide"><?php e('guide.title', $INST_NAME) ?></h2>
    <p><?php e('guide.lead') ?></p>
    <div class="pk-guide">
<?php foreach (t('guide.faqs') as $g): ?>
      <details class="gq">
        <summary><?= h($g[0]) ?></summary>
        <p><?= h($g[1]) ?></p>
      </details>
<?php endforeach; ?>
    </div>
    <a class="pk-more" href="<?= h($rootPath . '/' . $LANG . '/' . $INSTRUMENT . '/guide/') ?>">
      <span><?php e('guide.more', $INST_NAME) ?></span><span class="cv">›</span>
    </a>
  </section>
</div>

<!-- 頭出し（▶ の上）。先頭へ戻す。ループ中はループの先頭へ戻る（src/main.js） -->
<button id="cue" class="cue" disabled aria-label="<?php e('ui.cue_aria') ?>">⏮</button>
<button id="fab" class="fab" disabled aria-label="<?php e('ui.fab_aria') ?>">▶</button>

<!-- 画面左下のドック：テンポ / 伴奏 / オクターブ / ループ（ドロワーから移動） -->
<div id="dock" class="dock" data-m="score">
  <button id="dkTempo" class="dockbtn" aria-label="<?php e('ui.dk_tempo_aria') ?>"><i>BPM</i><small id="dkTempoV">80</small></button>
  <button id="enjoySw" class="dockbtn" data-m="score" aria-label="<?php e('ui.dk_enjoy_aria') ?>"><i>🥁</i><small><?php e('ui.dk_enjoy') ?></small></button>
  <button id="dkOct" class="dockbtn" data-m="score" aria-label="<?php e('ui.dk_oct_aria') ?>"><i>OCT</i><small id="dkOctV"><?php e('ui.dk_oct_auto') ?></small></button>
  <button id="dkLoop" class="dockbtn" aria-label="<?php e('ui.dk_loop_aria') ?>"><i>🔁</i><small><?php e('ui.dk_loop') ?></small></button>
</div>

<!-- ドックのモーダル -->
<div id="dockScrim" class="dkscrim"></div>

<div id="mTempo" class="dkmodal">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_tempo') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="tempobig">
    <button id="tempoDn" class="tstep" aria-label="<?php e('ui.tempo_dn') ?>">−</button>
    <span class="numbox big"><input id="tempoNum" type="number" min="30" max="160" step="1" value="80" inputmode="numeric"><i>bpm</i></span>
    <button id="tempoUp" class="tstep" aria-label="<?php e('ui.tempo_up') ?>">＋</button>
  </div>
  <div class="field">
    <div class="k"><?php e('ui.tempo_k') ?></div>
    <div class="v tempo">
      <input id="tempo" type="range" min="30" max="160" value="80">
    </div>
  </div>
  <div class="row controls">
    <button id="tempoReset" class="ghost"><?php e('ui.tempo_reset') ?></button>
  </div>
</div>

<div id="mOct" class="dkmodal">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_oct') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="octrow">
    <button class="oct on" data-oct="auto"><?php e('ui.oct_auto') ?></button>
    <button class="oct" data-oct="0"><?php e('ui.oct_orig') ?></button>
    <button class="oct" data-oct="-3">-3</button>
    <button class="oct" data-oct="-2">-2</button>
    <button class="oct" data-oct="-1">-1</button>
    <button class="oct" data-oct="1">+1</button>
    <button class="oct" data-oct="2">+2</button>
    <button class="oct" data-oct="3">+3</button>
  </div>
  <div id="octInfo" class="sub"></div>
</div>

<div id="mLoop" class="dkmodal">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_loop') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div id="loopSw" class="sw"><span><?php e('ui.loop_sw') ?></span><span class="knob"></span></div>
  <div data-m="score">
    <div class="field2">
      <div>
        <div class="k" style="font-size:12px;color:var(--muted);margin-bottom:4px"><?php e('ui.loop_from') ?></div>
        <div class="stepper">
          <button id="loopFromDn" class="sstep" aria-label="<?php e('ui.loop_dn') ?>">▼</button>
          <input id="loopFrom" type="number" min="1" value="1">
          <button id="loopFromUp" class="sstep" aria-label="<?php e('ui.loop_up') ?>">▲</button>
        </div>
      </div>
      <div>
        <div class="k" style="font-size:12px;color:var(--muted);margin-bottom:4px"><?php e('ui.loop_to') ?></div>
        <div class="stepper">
          <button id="loopToDn" class="sstep" aria-label="<?php e('ui.loop_dn') ?>">▼</button>
          <input id="loopTo" type="number" min="1" value="4">
          <button id="loopToUp" class="sstep" aria-label="<?php e('ui.loop_up') ?>">▲</button>
        </div>
      </div>
    </div>
    <div class="row controls" style="margin-top:10px">
      <button id="loopReset" class="ghost" style="flex:1; justify-content:center"><?php e('ui.loop_reset') ?></button>
    </div>
  </div>
  <div id="loopInfo" class="sub"><?php e('ui.loop_info') ?></div>
</div>

<!-- 楽器の切り替え（ドロワー見出しの楽器名から開く） -->
<div id="mInst" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_inst') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
<?php foreach (APP_INSTRUMENTS as $ins):
        $ic = require APP_ROOT . '/config/' . $ins . '.php'; ?>
  <a class="instrow<?= $ins === $INSTRUMENT ? ' on' : '' ?>" href="<?= h($rootPath . '/' . $LANG . '/' . $ins . '/') ?>">
    <span class="ic"><?= h($ic['emoji']) ?></span>
    <span class="nm"><?= h(t('instrument.' . $ins)) ?><?php if (empty($ic['ready'])): ?><small><?php e('ui.inst_soon') ?></small><?php endif; ?></span>
  </a>
<?php endforeach; ?>
</div>

<!-- 練習カレンダー（歯車の「累計練習時間」から開く）。中身は src/practice-ui.js が作る -->
<div id="mPractice" class="dkmodal prac" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt">💮 <?php e('prac.title') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>

  <div class="prac-sum">
    <div><span><?php e('prac.sum_all') ?></span><b id="pracSumAll">–</b></div>
    <div><span><?php e('prac.sum_month') ?></span><b id="pracSumMon">–</b></div>
    <div><span><?php e('prac.sum_days') ?></span><b id="pracSumDays">–</b></div>
  </div>

  <div class="prac-nav">
    <button type="button" id="pracPrev" class="iconbtn" aria-label="<?php e('prac.prev') ?>">‹</button>
    <span id="pracMonth" class="prac-mon"></span>
    <button type="button" id="pracNext" class="iconbtn" aria-label="<?php e('prac.next') ?>">›</button>
  </div>

  <div id="pracCal" class="prac-cal"></div>

  <div class="sub"><?php e('prac.note') ?></div>
</div>

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

<!-- 採点ゲーム：録音の準備。マイクの入力レベルを見せてから始める。
     ✕・「やめる」・スクリムはどれも src/game.js の cancelGameCheck()（マイクも閉じる）。 -->
<div id="mGameReady" class="dkmodal gready" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_game_ready') ?></span>
    <button id="gckClose" class="iconbtn" aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <ul class="gck-tips">
    <li><?php e('ui.game_tip_quiet') ?></li>
    <li><?php e('ui.game_tip_phone') ?></li>
    <li><?php e('ui.game_tip_near') ?></li>
  </ul>
  <!-- マイク入力レベル（チューナーと同じ見た目・同じ推奨区間） -->
  <div class="tun-in">
    <div class="tun-in-t"><span>🎤 <?php e('ui.tun_in') ?></span><b id="gckMsg">–</b></div>
    <div class="tun-in-bar">
      <div class="zones"></div>
      <div id="gckLevel" class="lv"></div>
      <div class="tick lo"></div>
      <div class="tick hi"></div>
    </div>
    <div class="tun-in-scale">
      <span class="s-lo"><?php e('ui.tun_in_lo') ?></span>
      <span class="s-ok"><?php e('ui.tun_in_ok') ?></span>
      <span class="s-hi"><?php e('ui.tun_in_hi') ?></span>
    </div>
  </div>
  <div class="row controls" style="margin-top:10px">
    <button id="gckGo" class="primary" style="flex:1; justify-content:center"><?php e('ui.game_ready_go') ?></button>
    <button id="gckCancel" class="ghost" style="flex:1; justify-content:center"><?php e('ui.game_ready_cancel') ?></button>
  </div>
  <div class="sub"><?php e('ui.game_ready_note') ?></div>
</div>

<!-- 採点ゲーム：採点結果。中身（点数・アドバイス・五線譜）は src/game.js が入れる -->
<div id="mGameRes" class="dkmodal gres" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_game_res') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="gres-top">
    <div id="gresRank" class="gres-rank">–</div>
    <div class="gres-num"><b id="gresScore">0.0</b><span><?php e('ui.game_point') ?></span></div>
  </div>
  <div id="gresCmp" class="gres-cmp"></div>
  <div id="gresBreak" class="gres-break"></div>
  <div class="seclbl"><?php e('ui.game_advice') ?></div>
  <ul id="gresAdvice" class="gres-adv"></ul>
  <div class="seclbl"><?php e('ui.game_staff') ?></div>
  <div id="gresStaff" class="gres-staff"></div>
  <div id="gresLegend" class="gres-legend">
    <span><i class="gl gl-ok"></i><?php e('ui.game_lg_ok') ?></span>
    <span><i class="gl gl-pitch"></i><?php e('ui.game_lg_pitch') ?></span>
    <span><i class="gl gl-time"></i><?php e('ui.game_lg_time') ?></span>
    <span><i class="gl gl-miss"></i><?php e('ui.game_lg_miss') ?></span>
  </div>
  <div class="row controls" style="margin-top:10px">
    <button id="gresRetry" class="primary" style="flex:1; justify-content:center"><?php e('ui.game_retry') ?></button>
    <button class="ghost" data-dkclose style="flex:1; justify-content:center"><?php e('ui.close') ?></button>
  </div>
  <div class="sub"><?php e('ui.game_res_note') ?></div>
</div>

<!-- 採点ゲーム：初めて開いたときの説明（1回だけ）。
     出したことは端末に残す（src/game.js の maybeShowGameIntro）。
     ✕・「分かった！」・「閉じる」はどれも data-dkclose ＝ 既存の closeDockModal で閉じる。 -->
<div id="mGameIntro" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_game_intro') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="sub sv-ask"><?php e('ui.game_intro_body') ?></div>
  <ol class="pk-steps">
<?php foreach (t('ui.game_intro_steps') as $s): ?>
    <li><?= h($s) ?></li>
<?php endforeach; ?>
  </ol>
  <div class="startrow" style="margin-top:12px">
    <button id="gameIntroOk" class="primary" data-dkclose><?php e('ui.game_intro_ok') ?></button>
    <button id="gameIntroClose" class="ghost" data-dkclose><?php e('ui.close') ?></button>
  </div>
  <div class="sub"><?php e('ui.game_intro_note') ?></div>
</div>

<!-- アップロードした楽譜：同じ譜面っぽいものがあるとき、上書きか新規追加かを尋ねる
     （中身まで同じときは尋ねずに何もしない。判定は src/uploads.js の findSimilar） -->
<div id="mUpDup" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_up_dup') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div id="upDupBody" class="sub sv-ask"></div>
  <div class="startrow" style="margin-top:12px">
    <button id="upDupOver" class="primary"><?php e('ui.up_dup_over') ?></button>
    <button id="upDupNew" class="ghost"><?php e('ui.up_dup_new') ?></button>
  </div>
  <div class="sub"><?php e('ui.up_dup_note') ?></div>
</div>

<!-- アップロードした楽譜：一覧に出す名前を変える（一覧の「名前」から開く。処理は src/uploads.js） -->
<div id="mUpName" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('share.m_rename') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="fmrow">
    <label for="upName"><?php e('share.rename_label') ?></label>
    <input id="upName" type="text" maxlength="120" autocomplete="off">
  </div>
  <div class="row controls">
    <button id="upNameGo" class="primary" style="flex:1; justify-content:center"><?php e('share.rename_do') ?></button>
  </div>
</div>

<!-- 読み込んだ楽譜を「みんなの曲」として公開する（一覧の「シェア」から開く。処理は src/shares.js）。
     利用規約への同意（#shAgree）が入っていないと公開できない。
     チェックは画面とサーバ（api/shares.php の agree）の両方で見ている。 -->
<div id="mShare" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('share.m_share') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="shwarn"><?php e('share.warn') ?></div>
  <label class="agree" for="shAgree">
    <input id="shAgree" type="checkbox">
    <span><?php e('share.agree') ?></span>
  </label>
  <div class="sub">
    <a href="<?= h($rootPath . '/' . $LANG . '/terms/') ?>" target="_blank" rel="noopener"><?php e('share.terms_link') ?></a>
  </div>
  <div class="row controls">
    <button id="shGo" class="primary" style="flex:1; justify-content:center"><?php e('share.go') ?></button>
  </div>
  <div id="shMsg" class="fmmsg" role="status"></div>
  <div class="sub"><?php e('share.note') ?></div>
</div>

<!-- 「曲を練習する」に入った時は案内モーダルを出さず、左ドロワーを直接開く
     （src/modes.js の setMode → openDrawer）。旧 #mScoreStart は廃止した。 -->

<!-- ハンバーガードロワー（操作パネル） -->
<div id="scrim" class="scrim"></div>
<aside id="drawer" class="drawer">
  <div class="drawer-top">
    <div class="drawer-head">
      <span class="accentbar"></span>
      <div class="dh-t"><button id="instBtn" class="instbtn" aria-haspopup="dialog"><?= h($INST['label']) ?><span class="cv">▾</span></button></div>
      <button id="drawerClose" class="iconbtn" aria-label="<?php e('ui.close') ?>">✕</button>
    </div>
    <div class="seg" id="modeSeg" role="tablist">
      <button data-mode="score"><?php e('ui.seg_score') ?></button>
      <button data-mode="game"><?php e('ui.seg_game') ?><span class="beta-badge">β</span></button>
      <button data-mode="tuner"><?php e('ui.seg_tuner') ?></button>
    </div>
  </div>

  <!-- ========== チューナーモード ========== -->
  <div data-m="tuner">
    <div class="seclbl"><?php e('ui.mic') ?></div>
    <div id="micSw" class="sw"><span><?php e('ui.mic_sw') ?></span><span class="knob"></span></div>
    <div class="sub"><?php e('ui.mic_note1') ?><br><?php e('ui.mic_note2') ?></div>
  </div>

  <!-- ========== コピー練習モード ========== -->
  <div data-m="score">
    <!-- 子タブ：曲を選ぶ / 譜面を読み込む -->
    <div class="subseg" id="scoreSubSeg">
      <button data-sub="songs" class="on"><?php e('ui.sub_songs') ?></button>
      <button data-sub="load"><?php e('ui.sub_load') ?></button>
    </div>

    <!-- 子タブ内容：曲を選ぶ
         一覧には、あらかじめ用意した曲（public/songs/manifest.json）に加えて、
         利用者が共有した曲（api/shares.php）も並ぶ。絞り込みと50件ごとのページ送りは
         src/songs.js の renderSongList() が両方まとめて行う。 -->
    <div class="subpanel" data-sub="songs">
      <!-- 見出しの右端に絞り込み。押すとお気に入りだけになる（一覧を作るのは src/songs.js） -->
      <div class="seclbl seclbl-row">
        <span><?php e('ui.songs') ?></span>
        <button type="button" id="favOnly" class="favfilter" aria-pressed="false">❤ <?php e('ui.fav_only') ?></button>
      </div>
      <div class="songfind">
        <input id="songQ" type="search" maxlength="60" autocomplete="off" placeholder="<?php e('share.find_ph') ?>">
      </div>
      <div id="songBtns" class="songlist">
        <button class="songbtn" disabled><?php e('ui.songs_loading') ?><small>public/songs/manifest.json</small></button>
      </div>
      <div id="songPager" class="pager" hidden></div>
      <div class="sub"><?php e('ui.songs_note') ?></div>
    </div>

    <!-- 子タブ内容：譜面を読み込む -->
    <div class="subpanel m-hide" data-sub="load">
      <div class="seclbl"><?php e('ui.score') ?></div>
      <div class="row controls">
        <label class="filebtn" style="flex:1; justify-content:center"><?php e('ui.file_open') ?><input id="file" type="file" accept=".xml,.musicxml,.mxl,.mid,.midi,audio/midi,audio/x-midi"></label>
      </div>
      <div class="sub"><?php e('ui.file_note') ?></div>

      <!-- ===== アップロードした楽譜（保存番号があるときだけサーバに残る。上限99件）=====
           一覧の中身・保存・削除は src/uploads.js。PHP 側では枠だけ出す。 -->
      <div class="seclbl"><?php e('ui.uploads') ?></div>
      <div id="upList" class="uplist"></div>
      <div id="upNote" class="sub"><?php e('ui.uploads_note', 3) ?></div>

    </div>

    <!-- 子タブ内容：MIDIトラック選択（MIDIを読み込むと自動でこの面に切り替わる）
         タブは出さず、「‹ 戻る」で「譜面を読み込む」へ戻る。切替は src/drawer.js の setScoreSub() -->
    <div class="subpanel m-hide" data-sub="tracks">
      <div class="gp-back">
        <button type="button" id="trackBack">‹ <?php e('ui.back') ?></button>
        <span class="t"><?php e('ui.tracks') ?></span>
      </div>
      <div id="tracks" class="tracks">
        <div id="trackList"></div>
        <div class="row controls">
          <button id="skipStart" class="ghost" style="flex:1; justify-content:center"><?php e('ui.skip_start') ?></button>
        </div>
        <div class="sub"><?php e('ui.tracks_note', $INST_NAME) ?></div>
      </div>
    </div>
  </div>

  <!-- ========== 採点ゲームモード ==========
       課題曲の一覧は「曲を練習する」と同じ public/songs/manifest.json から作る
       （中身を入れるのは src/game.js の renderGameSongs）。 -->
  <div data-m="game">
    <div class="seclbl"><?php e('ui.game_songs') ?></div>
    <div id="gameSongs" class="songlist">
      <button class="songbtn" disabled><?php e('ui.songs_loading') ?><small>public/songs/manifest.json</small></button>
    </div>
    <div class="sub"><?php e('ui.game_songs_note') ?></div>
    <hr class="sep">
    <div class="sub"><?php e('ui.game_start_note') ?></div>
    <!-- 課題曲の一覧が長いので、下までスクロールしないと押せなかった。
         下辺に貼り付けて、曲を選んだらそのまま押せるようにする（.gstart-bar） -->
    <div class="row controls gstart-bar">
      <button id="gameStart" class="primary" style="flex:1; justify-content:center; min-height:46px"><?php e('ui.game_start') ?></button>
    </div>
  </div>

  <!-- ========== 共通：推奨ポジション ==========
       UIは廃止（常にロー優先＝ST.pref の初期値のまま）。
       ST.pref / setPref() は src/modes.js に残してあるので、戻すときは
       このブロックの HTML と main.js の .pref 配線をいっしょに戻すこと。 -->

  <!-- ========== コピー練習モード：添削・保存 ==========
       「運指の保存」（書き出し／読み込み／リセット）のUIは廃止した。
       運指は編集した時点で端末と保存番号の両方へ自動保存されるため
       （src/drawer.js の saveFingering → src/uploads.js の updateUploadFingering）。
       exportFingering / importFingering / resetFingering は drawer.js に残してあるので、
       戻すときはこのブロックの HTML と main.js の配線をいっしょに戻すこと。 -->

  <div class="drawer-note">
    <?php er('ui.drawer_note_html') ?>
  </div>
</aside>

<!-- チューナー（下部シート） -->
<div id="tunerSheet" class="sheet">
  <div class="sheet-head">
    <span class="t"><?php e('ui.tuner_t') ?></span>
    <button id="tunerClose" class="iconbtn" aria-label="<?php e('ui.tuner_close_aria') ?>">✕</button>
  </div>
  <div class="tun-main">
    <div id="tunHz" class="tun-hz">– Hz</div>
    <div id="tunNote" class="tun-note">–</div>
    <div id="tunCent" class="tun-cent">– cent</div>
  </div>
  <div class="tun-bar">
    <div class="mid"></div>
    <div id="tunTrail" class="trl"></div>
    <div id="tunNeedle" class="ndl"></div>
  </div>
  <!-- 締める／緩める（3つとも書いておき、CSS で1つだけ見せる） -->
  <div id="tunDir" class="tun-dir">
    <span class="d-low"><?php e('ui.tun_tighten') ?></span>
    <span class="d-high"><?php e('ui.tun_loosen') ?></span>
    <span class="d-ok"><?php e('ui.tun_intune') ?></span>
    <span class="d-far"><?php e('ui.tun_far') ?></span>
  </div>
  <!-- 弦を選ぶと、その開放弦を基準に測る（自動判定の取り違えで締めすぎるのを防ぐ）。
       もう一度押すと自動判定に戻る。 -->
  <div class="tun-str-row">
    <span class="tsl"><?php e('ui.tun_thick') ?></span>
    <div class="tun-str">
<?php $NSTR = count($OPEN_LABELS); foreach ($OPEN_LABELS as $i => $lbl): ?><button type="button" data-str="<?= $i ?>"><b><?php e('ui.tun_str_n', $NSTR - $i) ?></b><small><?= h($lbl) ?></small></button><?php endforeach; ?>
    </div>
    <span class="tsl"><?php e('ui.tun_thin') ?></span>
  </div>
  <!-- 参考の音程。マイクとは別の AudioContext なので、マイク未許可でも鳴らせる -->
  <div class="tun-ref">
    <button id="tunRef" type="button" class="tun-ref-btn">
      <span class="r-play"><?php e('ui.tun_ref_play') ?></span>
      <span class="r-stop"><?php e('ui.tun_ref_stop') ?></span>
    </button>
    <b id="tunRefNote">A4</b><small class="tun-ref-o"><?php e('ui.tun_ref_oct') ?></small>
  </div>
  <div id="tunStrNote" class="tun-str-note"><?php e('ui.tun_pick_str') ?></div>
  <!-- マイク入力レベル（緑の区間＝推奨） -->
  <div class="tun-in">
    <div class="tun-in-t"><span>🎤 <?php e('ui.tun_in') ?></span><b id="tunInMsg">–</b></div>
    <div class="tun-in-bar">
      <div class="zones"></div>
      <div id="tunLevel" class="lv"></div>
      <div class="tick lo"></div>
      <div class="tick hi"></div>
    </div>
    <div class="tun-in-scale">
      <span class="s-lo"><?php e('ui.tun_in_lo') ?></span>
      <span class="s-ok"><?php e('ui.tun_in_ok') ?></span>
      <span class="s-hi"><?php e('ui.tun_in_hi') ?></span>
    </div>
    <div class="tun-in-sub"><?php e('ui.tun_in_note') ?></div>
  </div>
  <div id="tunHint" class="tun-hint"></div>
</div>

<!-- 運指編集（ボトムシート） -->
<div id="editSheet" class="sheet edit-sheet">
  <div class="sheet-head">
    <span class="t"><?php e('ui.edit_t') ?></span>
    <button id="editResetAll" class="iconbtn" aria-label="<?php e('ui.fing_reset_all') ?>" title="<?php e('ui.fing_reset_all') ?>">⟲</button>
    <button id="editClose" class="iconbtn" aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div id="edit" class="edit">
    <div class="empty-edit"><?php e('ui.edit_empty') ?></div>
  </div>
</div>

<!-- 冒頭カウント＝1小節ぶん（凡例はカウントダウンの下だけに出す＝カウントが終われば消える） -->
<div id="countin" class="countin">
  <span id="countnum"></span>
  <div id="legend" class="legend"></div>
</div>

<!-- 小節フラッシュ（シークバーで小節を移動した時に一瞬だけ出す） -->
<div id="mflash" class="mflash" aria-hidden="true"></div>

<!-- 採点ゲーム：録音中の表示（中身は src/game.js が書き換える） -->
<div id="gameRec" class="grec" aria-live="polite">
  <span class="gr-dot"></span>
  <span class="gr-t"><?php e('ui.game_rec') ?></span>
  <span id="gameRecPos" class="gr-pos">1</span>
  <button id="gameAbort" class="ghost"><?php e('ui.game_abort') ?></button>
</div>

<div id="toast" class="toast"></div>

</div><!-- /#app -->

  <!-- optional: .mxl（zip形式のMusicXML）の解凍。読み込めなくても .xml / .mid は動作する。
       ※ PDFの参照表示・読み取り（OMR）は廃止したので pdf.js は読み込まない。 -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" onerror="window.__noZip=1"></script>
  <script type="module" src="<?= h($BASE) ?>src/main.js"></script>
</body>
</html>
