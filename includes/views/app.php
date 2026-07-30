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
  <!-- 上段＝いま開いている譜面の名前（src/modes.js の renderScoreTitle）
       下段＝押さえる音の情報（renderNow）。曲名が音の情報で消えないよう2段にしている -->
  <div class="nowwrap">
    <div id="scoretitle" class="scoretitle"></div>
    <div id="nowline" class="nowbar"><?php e('ui.nowline') ?></div>
  </div>
  <button id="gear" class="iconbtn" aria-label="<?php e('ui.gear_aria') ?>">⚙</button>
</div>

<!-- 全画面 指板 -->
<div class="board-full">
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

    <!-- ===== 設定の保存（いちばん上）=====
         ログインではなく「保存番号」。表示は src/account.js が LocalStorage の番号で書き換える。
         PHP 側では何も出さない（ページをキャッシュ可能なままにしておくため）。 -->
    <div class="gp-t"><?php e('ui.save') ?></div>
    <div id="svWho" class="accwho"><?php e('ui.save_none') ?></div>
    <div class="row controls">
      <button id="svBtn" class="ghost"><?php e('ui.save_start') ?></button>
    </div>
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

    <!-- ===== ホーム画面に追加（対応ブラウザでのみ出る）===== -->
    <hr class="sep">
    <div id="pwaBox" class="row controls" hidden>
      <button id="pwaInstall" class="ghost" style="flex:1; justify-content:center"><?php e('ui.install') ?></button>
    </div>
    <div id="pwaNote" class="sub" hidden><?php e('ui.install_note') ?></div>

    <!-- ===== 言語（いちばん下）===== -->
    <hr class="sep">
    <div class="gp-t"><?php e('ui.lang_label') ?></div>
    <select id="langSel">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
      <option value="<?= h($l) ?>"<?= $l === $LANG ? ' selected' : '' ?>><?= h($ln['name']) ?></option>
<?php endforeach; ?>
    </select>
    <div class="sub" style="margin:6px 0 10px"><?php e('ui.lang_note') ?></div>

    <!-- ===== お問い合わせ（いちばん下）===== -->
    <hr class="sep">
    <div class="row controls">
      <button id="contactBtn" class="ghost" style="flex:1; justify-content:center"><?php e('ui.contact') ?></button>
    </div>
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
  <div class="pk-logo"><img src="<?= h($BASE) ?>public/icons/logo-v2.png" alt="<?= h(APP_NAME) ?>" width="512" height="512" decoding="async"></div>
  <h1 class="pk-title"><?= h(APP_NAME) ?></h1>
  <div class="pk-sub"><?php e('app_sub', $INST_NAME) ?></div>
  <button class="pk-card" data-mode="scale">
    <span class="pk-ic">🎵</span><span class="pk-b"><?php e('ui.mode_scale') ?><small><?php e('ui.mode_scale_s') ?></small></span>
  </button>
  <button class="pk-card" data-mode="score">
    <span class="pk-ic">🎼</span><span class="pk-b"><?php e('ui.mode_score') ?><small><?php e('ui.mode_score_s') ?></small></span>
  </button>
  <button class="pk-card" data-mode="tuner">
    <span class="pk-ic">🎯</span><span class="pk-b"><?php e('ui.mode_tuner') ?><small><?php e('ui.mode_tuner_s') ?></small></span>
  </button>
  <button class="pk-card" data-mode="game">
    <span class="pk-ic">🎮</span><span class="pk-b"><?php e('ui.mode_game') ?><small><?php e('ui.mode_game_s') ?></small></span>
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

<button id="fab" class="fab" disabled aria-label="<?php e('ui.fab_aria') ?>">▶</button>

<!-- 画面左下のドック：テンポ / 伴奏 / オクターブ / ループ（ドロワーから移動） -->
<div id="dock" class="dock" data-m="scale score">
  <button id="dkTempo" class="dockbtn" aria-label="<?php e('ui.dk_tempo_aria') ?>"><i>BPM</i><small id="dkTempoV">80</small></button>
  <button id="enjoySw" class="dockbtn" data-m="scale score" aria-label="<?php e('ui.dk_enjoy_aria') ?>"><i>🥁</i><small><?php e('ui.dk_enjoy') ?></small></button>
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

<!-- 設定の保存（歯車の「設定の保存」から開く。表示の出し分けは src/account.js） -->
<div id="mSave" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_save') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>

  <!-- 保存番号を持っているとき -->
  <div id="svBound" hidden>
    <div class="sv-label"><?php e('save.code_label') ?></div>
    <div id="svCode" class="sv-code"></div>
    <div class="row controls">
      <button id="svCopy" class="ghost" style="flex:1; justify-content:center"><?php e('save.copy') ?></button>
    </div>
    <div class="sub"><?php e('save.code_note') ?></div>
    <hr class="sep">
  </div>

  <!-- まだ持っていないとき -->
  <div id="svUnbound" hidden>
    <div class="sub"><?php e('save.none_note') ?></div>
    <div class="row controls" style="margin-top:10px">
      <button id="svCreate" class="primary" style="flex:1; justify-content:center"><?php e('save.create') ?></button>
    </div>
    <hr class="sep">
  </div>

  <!-- 他の端末の設定を引き継ぐ（両方の状態で使える） -->
  <div class="row controls">
    <button id="svLoadOpen" class="ghost" style="flex:1; justify-content:center"><?php e('save.load_open') ?></button>
  </div>
  <div id="svLoadBox" hidden>
    <div class="fmrow">
      <label for="svInput"><?php e('save.input_label') ?></label>
      <input id="svInput" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="G4821">
    </div>
    <div class="row controls">
      <button id="svLoad" class="primary" style="flex:1; justify-content:center"><?php e('save.load') ?></button>
    </div>
    <div class="sub"><?php e('save.load_note') ?></div>
  </div>

  <!-- 解除・削除（保存番号を持っているときだけ） -->
  <div id="svBound2" hidden>
    <hr class="sep">
    <div class="row controls">
      <button id="svUnlink" class="ghost" style="flex:1; justify-content:center"><?php e('save.unlink') ?></button>
    </div>
    <div class="sub"><?php e('save.unlink_note') ?></div>
    <div class="row controls" style="margin-top:10px">
      <button id="svDelete" class="ghost danger" style="flex:1; justify-content:center"><?php e('save.delete') ?></button>
    </div>
  </div>

  <div id="svMsg" class="fmmsg" role="status"></div>
</div>

<!-- 保存が要る操作をしたときに出す（保存番号をまだ持っていないときだけ） -->
<div id="mSaveAsk" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('save.ask_title') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="sub sv-ask"><?php e('save.ask_body') ?></div>
  <div class="startrow" style="margin-top:12px">
    <button id="svAskYes" class="primary"><?php e('save.ask_yes') ?></button>
    <button id="svAskNo" class="ghost"><?php e('save.ask_no') ?></button>
  </div>
</div>

<!-- お問い合わせ（歯車のいちばん下から開く） -->
<div id="mContact" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_contact') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="fmrow">
    <label for="ctName"><?php e('contact.name') ?></label>
    <input id="ctName" type="text" maxlength="60" autocomplete="name" placeholder="<?php e('contact.name_ph') ?>">
  </div>
  <div class="fmrow">
    <label for="ctMail"><?php e('contact.email') ?></label>
    <input id="ctMail" type="email" maxlength="120" autocomplete="email" placeholder="you@example.com">
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

<!-- 曲を練習：入口から入った時の案内（押すとドロワーが横から出る） -->
<div id="mScoreStart" class="dkmodal" role="dialog" aria-modal="true">
  <div class="dk-head">
    <span class="dk-tt"><?php e('ui.m_score_start') ?></span>
    <button class="iconbtn" data-dkclose aria-label="<?php e('ui.close') ?>">✕</button>
  </div>
  <div class="startrow">
    <button data-sub="songs"><?php e('ui.sub_songs') ?></button>
    <button data-sub="load"><?php e('ui.sub_load') ?></button>
  </div>
  <div class="sub"><?php e('ui.score_start_note') ?></div>
</div>

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
      <button data-mode="scale"><?php e('ui.seg_scale') ?></button>
      <button data-mode="score"><?php e('ui.seg_score') ?></button>
      <button data-mode="tuner"><?php e('ui.seg_tuner') ?></button>
    </div>
  </div>

  <!-- ========== チューナーモード ========== -->
  <div data-m="tuner">
    <div class="seclbl"><?php e('ui.mic') ?></div>
    <div id="micSw" class="sw"><span><?php e('ui.mic_sw') ?></span><span class="knob"></span></div>
    <div class="sub"><?php e('ui.mic_note1') ?><br><?php e('ui.mic_note2') ?></div>
  </div>

  <!-- ========== スケール練習モード ========== -->
  <div data-m="scale">
    <div class="seclbl"><?php e('ui.scale_set') ?></div>
    <div class="field2">
      <div>
        <div class="k" style="font-size:12px;color:var(--muted);margin-bottom:4px"><?php e('ui.key') ?></div>
        <select id="scaleRoot">
<?php foreach ([[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,6],[7,7],[8,8],[9,9],[10,10],[11,11]] as [$pc, $i]):
        /* キー名は音名テーブルから生成（言語で音名を変えた場合も追従する） */
        $lbl = $NOTE_NAMES[$pc];
        if (in_array($pc, [1,3,6,8,10], true)) $lbl .= '/' . $NOTE_NAMES[($pc + 1) % 12] . '♭'; ?>
          <option value="<?= $pc ?>"><?= h($lbl) ?></option>
<?php endforeach; ?>
        </select>
      </div>
      <div>
        <div class="k" style="font-size:12px;color:var(--muted);margin-bottom:4px"><?php e('ui.octave') ?></div>
        <select id="scaleOct">
          <option value="1">1</option><option value="2" selected>2</option><option value="3">3</option>
        </select>
      </div>
    </div>
    <div class="field">
      <div class="k"><?php e('ui.scale') ?></div>
      <div class="v">
        <select id="scaleType">
          <option value="pop"><?php e('ui.scale_pop') ?></option>
        </select>
      </div>
    </div>
  </div>

  <!-- ========== コピー練習モード ========== -->
  <div data-m="score">
    <!-- 子タブ：曲を選ぶ / 譜面を読み込む -->
    <div class="subseg" id="scoreSubSeg">
      <button data-sub="songs" class="on"><?php e('ui.sub_songs') ?></button>
      <button data-sub="load"><?php e('ui.sub_load') ?></button>
    </div>

    <!-- 子タブ内容：曲を選ぶ -->
    <div class="subpanel" data-sub="songs">
      <div class="seclbl"><?php e('ui.songs') ?></div>
      <div id="songBtns" class="songlist">
        <button class="songbtn" disabled><?php e('ui.songs_loading') ?><small>public/songs/manifest.json</small></button>
      </div>
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
      <div id="upNote" class="sub"><?php e('ui.uploads_note', 99) ?></div>

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

  <!-- ========== スケール練習モード：生成（一番下） ========== -->
  <div data-m="scale">
    <hr class="sep">
    <div class="row controls">
      <button id="scaleGen" class="primary" style="flex:1; justify-content:center; min-height:46px"><?php e('ui.scale_gen') ?></button>
    </div>
  </div>

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

<div id="toast" class="toast"></div>

</div><!-- /#app -->

  <!-- optional: .mxl（zip形式のMusicXML）の解凍。読み込めなくても .xml / .mid は動作する。
       ※ PDFの参照表示・読み取り（OMR）は廃止したので pdf.js は読み込まない。 -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" onerror="window.__noZip=1"></script>
  <script type="module" src="<?= h($BASE) ?>src/main.js"></script>
</body>
</html>
