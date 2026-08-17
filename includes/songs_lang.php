<?php
/*
  includes/songs_lang.php — 曲の紹介ページ（includes/songs.php）専用の文言。

  本体の辞書（includes/lang/*.php）とは別に、このページで使うコピーだけをここに集約する。
  こうしておくと、本体の辞書を触らずに紹介ページの文言を直せる（キーの数合わせ事故も起きない）。
  楽器名・サイト名など共通のものは本体の $T / 定数（APP_NAME など）を使うので、ここには持たない。

  %s / %1$s / %2$s / %d は置換される:
    song_title  … %s  = 曲名
    song_desc   … %1$s = 曲名 / %2$s = 曲の説明
    practice_on … %s  = 楽器名
    count_label … %d  = 収録曲数
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

return [

  'ja' => [
    'index_title'      => '弦楽器の練習曲一覧｜バイオリン・ビオラ・チェロ・コントラバス｜GEN strings',
    'index_desc'       => '指板の押さえる位置・指番号・音程を確かめながら練習できる曲の一覧です。曲を選ぶと、お手本の音と一緒に練習できます。',
    'index_h1'         => '練習できる曲一覧',
    'index_lead'       => '曲を選ぶと、指板に押さえる位置・指番号・音程が出ます。お手本の再生に合わせて練習しましょう。',
    'count_label'      => '収録曲 %d 曲',
    'song_title'       => '%sの弦楽器練習｜運指・指板・お手本再生｜GEN strings',
    'song_desc'        => '%1$s（%2$s）を、指板の押さえる位置・指番号・音程を確かめながら練習できます。バイオリン・ビオラ・チェロ・コントラバスに対応。',
    'about_h'          => 'この曲について',
    'about_p'          => '押さえる位置・指番号・音程を画面で確かめながら、お手本の音に合わせて練習できます。テンポ変更・メトロノーム・区間くり返しにも対応しています。',
    'choose_inst_h'    => '練習する楽器を選ぶ',
    'practice_on'      => '%sで練習する',
    'practice_cta_sub' => 'この曲をひらく',
    'to_list'          => '← 曲一覧へ',
    'all_songs'        => 'すべての曲を見る',
    'back_home'        => '← 楽器をえらぶ',
    'level_label'      => '難易度：',
    'levels'           => [1 => 'やさしい', 2 => 'ふつう', 3 => 'むずかしい'],
    'crumb_home'       => 'ホーム',
    'crumb_songs'      => '曲一覧',
  ],

  'en' => [
    'index_title'      => 'String Practice Songs — Violin, Viola, Cello & Double Bass | GEN strings',
    'index_desc'       => 'A list of songs you can practice while checking finger positions, finger numbers and pitch on the fingerboard. Pick a song and play along with the built-in guide.',
    'index_h1'         => 'Songs you can practice',
    'index_lead'       => 'Choose a song to see finger positions, finger numbers and pitch on the fingerboard, then play along with the guide.',
    'count_label'      => '%d songs',
    'song_title'       => '%s for Strings — Fingering, Fingerboard & Play-Along | GEN strings',
    'song_desc'        => 'Practice %1$s (%2$s) while checking finger positions, finger numbers and pitch on the fingerboard. Works on violin, viola, cello and double bass.',
    'about_h'          => 'About this song',
    'about_p'          => 'See finger positions, finger numbers and pitch on screen and play along with the guide. Tempo change, metronome and section looping are supported.',
    'choose_inst_h'    => 'Choose an instrument to practice',
    'practice_on'      => 'Practice on %s',
    'practice_cta_sub' => 'Open this song',
    'to_list'          => '← All songs',
    'all_songs'        => 'See all songs',
    'back_home'        => '← Choose instrument',
    'level_label'      => 'Level: ',
    'levels'           => [1 => 'Easy', 2 => 'Medium', 3 => 'Hard'],
    'crumb_home'       => 'Home',
    'crumb_songs'      => 'Songs',
  ],

  'es' => [
    'index_title'      => 'Canciones para practicar cuerdas — violín, viola, violonchelo y contrabajo | GEN strings',
    'index_desc'       => 'Lista de canciones para practicar mientras compruebas la posición de los dedos, el número de dedo y la afinación en el diapasón. Elige una y toca con la guía.',
    'index_h1'         => 'Canciones para practicar',
    'index_lead'       => 'Elige una canción para ver la posición de los dedos, el número de dedo y la afinación en el diapasón, y toca junto a la guía.',
    'count_label'      => '%d canciones',
    'song_title'       => '%s para cuerdas — digitación, diapasón y acompañamiento | GEN strings',
    'song_desc'        => 'Practica %1$s (%2$s) comprobando la posición de los dedos, el número de dedo y la afinación en el diapasón. Compatible con violín, viola, violonchelo y contrabajo.',
    'about_h'          => 'Sobre esta canción',
    'about_p'          => 'Consulta en pantalla la posición de los dedos, el número de dedo y la afinación, y toca junto a la guía. Admite cambio de tempo, metrónomo y repetición de secciones.',
    'choose_inst_h'    => 'Elige un instrumento para practicar',
    'practice_on'      => 'Practicar en %s',
    'practice_cta_sub' => 'Abrir esta canción',
    'to_list'          => '← Todas las canciones',
    'all_songs'        => 'Ver todas las canciones',
    'back_home'        => '← Elegir instrumento',
    'level_label'      => 'Nivel: ',
    'levels'           => [1 => 'Fácil', 2 => 'Medio', 3 => 'Difícil'],
    'crumb_home'       => 'Inicio',
    'crumb_songs'      => 'Canciones',
  ],

  'zh' => [
    'index_title'      => '弦乐练习曲目 — 小提琴・中提琴・大提琴・低音提琴 | GEN strings',
    'index_desc'       => '可一边确认指板上的按弦位置、指法与音准一边练习的曲目列表。选择曲目即可跟随示范一起练习。',
    'index_h1'         => '可练习的曲目',
    'index_lead'       => '选择曲目后，指板上会显示按弦位置、指法与音准，跟随示范一起练习。',
    'count_label'      => '共 %d 首',
    'song_title'       => '%s的弦乐练习 — 指法・指板・示范播放 | GEN strings',
    'song_desc'        => '一边确认指板上的按弦位置、指法与音准，一边练习《%1$s》（%2$s）。支持小提琴、中提琴、大提琴与低音提琴。',
    'about_h'          => '关于此曲',
    'about_p'          => '在屏幕上确认按弦位置、指法与音准，并跟随示范一起练习。支持变速、节拍器与区间循环。',
    'choose_inst_h'    => '选择练习的乐器',
    'practice_on'      => '用%s练习',
    'practice_cta_sub' => '打开此曲',
    'to_list'          => '← 返回曲目列表',
    'all_songs'        => '查看全部曲目',
    'back_home'        => '← 选择乐器',
    'level_label'      => '难度：',
    'levels'           => [1 => '简单', 2 => '中等', 3 => '较难'],
    'crumb_home'       => '首页',
    'crumb_songs'      => '曲目',
  ],

];
