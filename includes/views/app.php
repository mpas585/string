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
  <meta name="theme-color" content="#1a1a2e">
  <title><?= h(t('page_title', $INST_NAME)) ?></title>
  <meta name="description" content="<?= h(t('intro.lead', $INST_NAME)) ?>">
  <link rel="canonical" href="<?= h($origin . $LANG_URLS[$LANG]) ?>">
<?php foreach (APP_LANGS as $l): ?>
  <link rel="alternate" hreflang="<?= h($l) ?>" href="<?= h($origin . $LANG_URLS[$l]) ?>">
<?php endforeach; ?>
<?php if ($INSTRUMENT === APP_DEFAULT_INSTRUMENT): /* ルートは Accept-Language で振り分ける言語中立ページ。既定楽器のときだけ x-default を出す */ ?>
  <link rel="alternate" hreflang="x-default" href="<?= h($origin . $rootPath . '/') ?>">
<?php endif; ?>

  <script type="application/ld+json">
<?php
  /* FAQ の構造化データ。文言は includes/lang/*.php の intro.faqs と同じものを使う
     （画面に見えている内容と一致していることが要件）。
     JSON_HEX_TAG は文言に < > が入っても </script> で抜けないようにするため。 */
  $faq = ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => []];
  foreach (t('intro.faqs') as $q) {
    $faq['mainEntity'][] = [
      '@type' => 'Question',
      'name'  => $q[0],
      'acceptedAnswer' => ['@type' => 'Answer', 'text' => $q[1]],
    ];
  }
  echo json_encode($faq, $JSON | JSON_HEX_TAG | JSON_PRETTY_PRINT);
?>
  </script>

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
  <div id="nowline" class="nowbar"><?php e('ui.nowline') ?></div>
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

  <div class="gp-t"><?php e('ui.lang_label') ?></div>
  <select id="langSel">
<?php foreach (APP_LANGS as $l):
        $ln = require APP_ROOT . '/includes/lang/' . $l . '.php'; ?>
    <option value="<?= h($l) ?>"<?= $l === $LANG ? ' selected' : '' ?>><?= h($ln['name']) ?></option>
<?php endforeach; ?>
  </select>
  <div class="sub" style="margin:6px 0 10px"><?php e('ui.lang_note') ?></div>

  <div class="gp-t"><?php e('ui.view') ?></div>
  <div class="seg2" id="viewSeg">
    <button data-view="board"><?php e('ui.view_board') ?></button>
    <button data-view="staff"><?php e('ui.view_staff') ?></button>
  </div>
  <div id="fretSw" class="sw on"><span><?php e('ui.frets') ?></span><span class="knob"></span></div>
  <div id="landSw" class="sw"><span><?php e('ui.landscape') ?></span><span class="knob"></span></div>
  <div class="sub" style="margin:-3px 0 8px"><?php e('ui.landscape_note') ?></div>

  <div class="gp-t"><?php e('ui.playback') ?></div>
  <div id="countSw" class="sw on"><span><?php e('ui.countin') ?></span><span class="knob"></span></div>
  <div id="awakeSw" class="sw on"><span><?php e('ui.keepawake') ?></span><span class="knob"></span></div>

  <div class="gp-t" style="margin-top:12px"><?php e('ui.zoom') ?></div>
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

  <div class="gp-t" style="margin-top:12px"><?php e('ui.volume') ?></div>
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
  <div class="pk-logo"><?= h($INST['emoji']) ?></div>
  <h1 class="pk-title"><?= h($INST['title_en']) ?></h1>
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
  </section>
</div>

<button id="fab" class="fab" disabled aria-label="<?php e('ui.fab_aria') ?>">▶</button>

<!-- 画面左下のドック：テンポ / 伴奏 / オクターブ / ループ（ドロワーから移動） -->
<div id="dock" class="dock" data-m="scale score">
  <button id="dkTempo" class="dockbtn" aria-label="<?php e('ui.dk_tempo_aria') ?>"><i>BPM</i><small id="dkTempoV">80</small></button>
  <button id="enjoySw" class="dockbtn" data-m="scale score" aria-label="<?php e('ui.dk_enjoy_aria') ?>"><i>🥁</i><small><?php e('ui.dk_enjoy') ?></small></button>
  <button id="dkOct" class="dockbtn" data-m="score" aria-label="<?php e('ui.dk_oct_aria') ?>"><i>Oct</i><small id="dkOctV"><?php e('ui.dk_oct_auto') ?></small></button>
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
        <label class="filebtn"><?php e('ui.file_open') ?><input id="file" type="file" accept=".xml,.musicxml,.mxl,.mid,.midi,.pdf,audio/midi,audio/x-midi"></label>
        <button id="pdfOpen" class="ghost"><?php e('ui.pdf_btn') ?></button>
      </div>
      <div class="sub"><?php e('ui.file_note') ?></div>

      <div id="tracks" class="tracks">
        <div class="seclbl"><?php e('ui.tracks') ?></div>
        <div id="trackList"></div>
        <div class="row controls">
          <button id="skipStart" class="ghost" style="flex:1; justify-content:center"><?php e('ui.skip_start') ?></button>
        </div>
        <div class="sub"><?php e('ui.tracks_note', $INST_NAME) ?></div>
      </div>
    </div>
  </div>

  <!-- ========== 共通：推奨ポジション ========== -->
  <div data-m="scale score">
    <hr class="sep">
    <div class="seclbl"><?php e('ui.pref') ?></div>
    <div class="row controls" style="gap:6px">
      <button class="pref on" data-pref="low"><?php e('zone.low') ?></button>
      <button class="pref" data-pref="mid"><?php e('zone.mid') ?></button>
      <button class="pref" data-pref="high"><?php e('zone.high') ?></button>
    </div>

  </div>

  <!-- ========== コピー練習モード：添削・保存 ========== -->
  <div data-m="score">
    <hr class="sep">
    <div class="seclbl"><?php e('ui.fing_save') ?></div>
    <div class="row controls">
      <button id="fingExport" class="ghost"><?php e('ui.fing_export') ?></button>
      <label class="filebtn"><?php e('ui.fing_import') ?><input id="fingFile" type="file" accept=".json"></label>
      <button id="fingReset" class="ghost"><?php e('ui.fing_reset') ?></button>
    </div>
    <div id="storeInfo" class="sub"><?php e('ui.fing_note') ?></div>
  </div>

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

<!-- PDF参照オーバーレイ -->
<div id="pdfOverlay" class="pdf-overlay">
  <div class="pdf-head">
    <button id="pdfClose" class="iconbtn" aria-label="<?php e('ui.close') ?>">✕</button>
    <label class="filebtn"><?php e('ui.pdf_open') ?><input id="pdffile" type="file" accept=".pdf"></label>
    <button id="pdfprev" class="iconbtn" disabled>‹</button>
    <b id="pdfpage">– / –</b>
    <button id="pdfnext" class="iconbtn" disabled>›</button>
    <span class="sp"></span>
  </div>
  <div class="pdf-scroll">
    <div class="note-note"><?php er('ui.pdf_note_html') ?></div>
    <canvas id="pdfcanvas"></canvas>
    <div id="pdfempty" class="empty" style="position:static; display:block; pointer-events:auto; padding:30px 0; text-align:center"><?php e('ui.pdf_empty') ?></div>
  </div>
</div>

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

<div id="toast" class="toast"></div>

</div><!-- /#app -->

  <!-- optional: .mxl 解凍 / PDF表示（読み込めなくてもコア機能は動作）。元と同じくグローバル読み込み。 -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" onerror="window.__noZip=1"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" onerror="window.__noPdf=1"></script>
  <script type="module" src="<?= h($BASE) ?>src/main.js"></script>
</body>
</html>
