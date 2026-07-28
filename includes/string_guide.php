<?php
/*
  string_guide.php — お悩み集（アーカイブページ）の基幹。
  /{言語}/{楽器}/guide/index.php から呼ばれる唯一の入口。

  呼び出し側で $LANG と $INSTRUMENT を定義しておくこと:
      $LANG = 'ja'; $INSTRUMENT = 'cello';
      require __DIR__ . '/../../../includes/string_guide.php';

  やることは includes/string_instrument.php と同じ組み立てで、ビューだけ別
  （includes/views/guide.php）。文言は includes/lang/*.php の 'guide'。

  ※ 準備中の楽器（config/{楽器}.php の ready=false）は記事も出さない。
     アプリ本体側の「準備中」ページ（soon.php）へ送る。
*/

if (!defined('STRING_APP')) { define('STRING_APP', 1); }
if (!defined('APP_ROOT'))   { define('APP_ROOT', dirname(__DIR__)); }

/* 直接 URL で叩かれた場合は拒否（$LANG/$INSTRUMENT が無いまま配信してしまうため） */
if (realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'] ?? '')) { http_response_code(403); exit; }

$URL_DEPTH = 3;                                         /* 公開URLは /{言語}/{楽器}/guide/ の3階層 */
require __DIR__ . '/bootstrap.php';

/* ===== 検証（ホワイトリスト外は既定値。require のパスに直接使うため必須） ===== */
$INSTRUMENT = (isset($INSTRUMENT) && in_array($INSTRUMENT, APP_INSTRUMENTS, true)) ? $INSTRUMENT : APP_DEFAULT_INSTRUMENT;
$INST       = require APP_ROOT . '/config/' . $INSTRUMENT . '.php';
$INST_NAME  = t('instrument.' . $INSTRUMENT);

/* アプリ本体のURL（戻るリンク）と、この記事一覧の各言語版URL */
$APP_URL   = $rootPath . '/' . $LANG . '/' . $INSTRUMENT . '/';
$LANG_URLS = [];
foreach (APP_LANGS as $l) { $LANG_URLS[$l] = $rootPath . '/' . $l . '/' . $INSTRUMENT . '/guide/'; }

$JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

/* 準備中の楽器はアプリ本体（＝準備中ページ）へ戻す */
if (empty($INST['ready'])) {
  header('Location: ' . $APP_URL, true, 302);
  exit;
}

app_send_csp();                                         /* 読み込み先は同一サーバのみ（bootstrap.php） */
header('Content-Type: text/html; charset=UTF-8');
require APP_ROOT . '/includes/views/guide.php';
