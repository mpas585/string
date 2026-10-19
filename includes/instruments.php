<?php
/*
  includes/instruments.php — 楽器の「表示する／隠す」の判定（1か所にまとめる）。

  隠した楽器は
    ・トップの楽器選択、アプリ内の楽器切替、曲紹介ページの「この楽器で練習」から消える
    ・sitemap とホーム画面アイコンの長押しメニュー（manifest の shortcuts）にも出さない
    ・/{言語}/{楽器}/ と /{言語}/{楽器}/guide/ へ直接来た人は既定楽器へ 302 で送る
      （301 にしないのは、あとで戻したときに古い転送がブラウザに残らないようにするため）
  config/{楽器}.php・ページの実体・保存済みの運指データは消さない。戻すのは一覧を変えるだけ。

  隠す楽器の決め方:
    config/app.php に 'hidden_instruments' => [...] があればそれを使う（[] なら全部出す）。
    無ければ下の APP_HIDDEN_DEFAULT（チェロ以外を隠す）。
    既定楽器（config/app.php の default_instrument）はどちらの場合でも隠さない。

  使う場所: includes/bootstrap.php（APP_HIDDEN_INSTRUMENTS / APP_VISIBLE_INSTRUMENTS を定義）、
            sitemap.php / manifest.php（bootstrap を通らないので直接呼ぶ）。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

/* config/app.php に指定が無いときに隠す楽器 */
if (!defined('APP_HIDDEN_DEFAULT')) {
  define('APP_HIDDEN_DEFAULT', ['violin', 'viola', 'contrabass']);
}

if (!function_exists('app_hidden_instruments')) {
  /* 隠す楽器（config/app.php の instruments に載っているものだけ。既定楽器は除く） */
  function app_hidden_instruments(array $cfg): array {
    $list = array_key_exists('hidden_instruments', $cfg) ? (array)$cfg['hidden_instruments'] : APP_HIDDEN_DEFAULT;
    $all  = (array)($cfg['instruments'] ?? []);
    $def  = (string)($cfg['default_instrument'] ?? '');
    $out  = [];
    foreach ($list as $i) {
      if (in_array($i, $all, true) && $i !== $def && !in_array($i, $out, true)) { $out[] = $i; }
    }
    return $out;
  }
}

if (!function_exists('app_visible_instruments')) {
  /* 一覧に出す楽器（config/app.php の並び順のまま） */
  function app_visible_instruments(array $cfg): array {
    $hidden = app_hidden_instruments($cfg);
    return array_values(array_filter((array)($cfg['instruments'] ?? []), function ($i) use ($hidden) {
      return !in_array($i, $hidden, true);
    }));
  }
}
