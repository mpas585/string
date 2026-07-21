<?php
/*
  includes/lang/es.php — Español. Copia de ja.php con las mismas claves.
  note_names: se deja en notación anglosajona (C, D, E…) para no cambiar el
  ancho del texto en el diapasón. Para usar Do Re Mi, sustituir esa línea.
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

return [
  'html_lang'  => 'es',
  'name'       => 'Español',

  'note_names' => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  /* Do Re Mi 版：['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'] */

  'zone' => [
    'open'       => 'Al aire',
    'low'        => 'Baja',
    'mid'        => 'Media',
    'high'       => 'Alta',
    'high_thumb' => 'Alta (pulgar)',
  ],
  'finger' => [
    'open'  => '0',
    'thumb' => 'P',
  ],
  'instrument' => [
    'cello'  => 'violonchelo',
    'violin' => 'violín',
    'viola'  => 'viola',
  ],

  'page_title' => 'App de práctica de %s | diapasón, digitación y afinador',
  'app_sub'    => 'App de práctica de %s',

  'ui' => [
    'menu'           => 'Menú',
    'nowline'        => 'Abre una partitura',
    'gear_aria'      => 'Ajustes del diapasón',
    'close'          => 'Cerrar',
    'settings'       => '⚙ Ajustes',
    'lang_label'     => 'Idioma / Language',
    'lang_note'      => 'Al elegir un idioma se abre esa versión de la página',

    'view'           => 'Vista',
    'view_board'     => '🎻 Diapasón',
    'view_staff'     => '🎼 Partitura',
    'frets'          => 'Mostrar líneas de trastes',
    'landscape'      => 'Pantalla horizontal',
    'landscape_note' => 'La partitura se lee mejor en horizontal',

    'playback'       => 'Reproducción',
    'countin'        => 'Cuenta de 4 al empezar',
    'keepawake'      => 'Mantener la pantalla activa',

    'zoom'           => 'Zoom del diapasón',
    'zoom_k'         => 'Escala',
    'zoom_fit'       => 'Ajustar',
    'zoom_reset'     => '100%',

    'volume'         => 'Volumen',
    'vol_master'     => 'General',
    'vol_lead'       => 'Melodía',
    'vol_drum'       => 'Batería',
    'vol_bass'       => 'Bajo',
    'vol_chord'      => 'Acordes',
    'vol_metro'      => 'Metrónomo',
    'vol_reset'      => 'Restablecer volúmenes',

    'empty_t'        => 'Carga una partitura',
    'empty_s'        => '→ abre una partitura o elige una canción',

    'mode_scale'     => 'Práctica de escalas',
    'mode_scale_s'   => 'Técnica básica',
    'mode_score'     => 'Practicar una pieza',
    'mode_score_s'   => 'Elige una canción (o carga una partitura)',
    'mode_tuner'     => 'Afinador',
    'mode_tuner_s'   => 'Detección de afinación en tiempo real',
    'mode_game'      => 'Minijuego',
    'mode_game_s'    => 'Próximamente',

    'fab_aria'       => 'Reproducir / Detener',
    'dk_tempo_aria'  => 'Ajustar el tempo',
    'dk_enjoy_aria'  => 'Acompañamiento ON/OFF',
    'dk_enjoy'       => 'Acomp.',
    'dk_oct_aria'    => 'Ajustar la octava',
    'dk_oct_auto'    => 'Auto',
    'dk_loop_aria'   => 'Ajustar el bucle',
    'dk_loop'        => 'Bucle',

    'm_tempo'        => '⏱ Tempo',
    'tempo_k'        => 'Velocidad',
    'm_oct'          => 'Oct Octava',
    'oct_auto'       => 'Auto',
    'oct_orig'       => 'Original',
    'm_loop'         => '🔁 Ajustes del bucle',
    'm_inst'         => '🎻 Elegir instrumento',
    'inst_soon'      => 'Próximamente',
    'loop_sw'        => 'Repetir en bucle',
    'loop_from'      => 'Compás inicial',
    'loop_to'        => 'Compás final',
    'loop_info'      => 'Repite los compases indicados (p. ej. 34–40)',

    'seg_scale'      => '🎵 Escalas',
    'seg_score'      => '🎼 Piezas',
    'seg_tuner'      => '🎯 Afinador',

    'mic'            => 'Micrófono',
    'mic_sw'         => 'Detectar la afinación con el micrófono',
    'mic_note1'      => 'La nota que toques aparece en el diapasón.',
    'mic_note2'      => 'El micrófono solo funciona en https:// o localhost (no en file://).',

    'scale_set'      => 'Ajustes de escala',
    'key'            => 'Tonalidad',
    'octave'         => 'Octavas',
    'scale'          => 'Escala',
    'scale_pop'      => '🎵 Pop (mayor)',

    'sub_songs'      => '🎵 Elegir canción',
    'sub_load'       => '📂 Cargar partitura',
    'songs'          => 'Elegir canción',
    'songs_loading'  => '🎼 Cargando…',
    'songs_note'     => 'Al elegir una canción se carga su partitura',

    'score'          => 'Partitura',
    'file_open'      => '🎼 Abrir',
    'pdf_btn'        => '📄 PDF',
    'file_note'      => 'Compatible con MusicXML (.xml/.musicxml/.mxl) y MIDI (.mid)',
    'tracks'         => 'Pista MIDI',
    'skip_start'     => '⏭ Ir a la primera nota',
    'tracks_note'    => 'Toca el nombre de una pista para escucharla. Se preselecciona la más cercana al registro del %s.',

    'pref'           => 'Posición recomendada',

    'fing_save'      => 'Digitación guardada',
    'fing_export'    => 'Exportar',
    'fing_import'    => 'Importar',
    'fing_reset'     => 'Restablecer',
    'fing_note'      => 'La digitación editada se guarda automáticamente',

    'scale_gen'      => 'Generar escala',

    'drawer_note_html' => 'La posición del dedo se calcula con la proporción de la cuerda (1 − 2<sup>−semitonos/12</sup>). Los nombres de posición y los números de dedo son orientativos.<br>Todo funciona en local: no se envía ningún dato fuera del dispositivo.',

    'pdf_open'       => '📄 Abrir',
    'pdf_note_html'  => 'El PDF es <b>solo de referencia</b>. El reconocimiento óptico de partituras no es posible solo en el navegador, así que la digitación y la reproducción se importan desde MusicXML.',
    'pdf_empty'      => 'Elige un archivo PDF para verlo aquí',

    'tuner_t'        => 'Afinador / detección de altura',
    'tun_in'         => 'Nivel de entrada',
    'tun_in_note'    => 'Ajusta la distancia al micrófono y el volumen de entrada para mantenerte dentro de la banda verde',

    'edit_t'         => '👇 Puedes cambiar la digitación',
    'edit_empty'     => 'Selecciona una nota para editar su digitación',
  ],

  'intro' => [
    'title' => 'Sobre esta app',
    'lead'  => 'Una aplicación web que muestra el diapasón del %s en la pantalla del móvil para comprobar la posición, el número de dedo y la afinación mientras practicas. No hay que instalar nada: funciona en el navegador.',
    'items' => [
      ['🎵', 'Práctica de escalas',   'Elige tonalidad y número de octavas y la escala aparece en el diapasón y en la partitura, con acompañamiento y metrónomo.'],
      ['🎼', 'Practicar una pieza',   'Elige una de las canciones incluidas o carga MusicXML / MIDI para obtener una partitura con digitación. Puedes corregirla tocando la pantalla.'],
      ['🎯', 'Afinador',              'Detecta la afinación con el micrófono y muestra en el diapasón dónde está la nota que suena.'],
    ],
    'feat_title' => 'Qué puedes hacer',
    'feats' => [
      'La posición del dedo se calcula a partir de la proporción de la cuerda. Los nombres de posición (al aire, baja, media, alta) y los números de dedo se muestran como orientación.',
      'Elige la tonalidad y el número de octavas y la escala aparece en el diapasón y en la partitura, con acompañamiento (batería, bajo, acordes) y metrónomo.',
      'Puedes cargar partituras en MusicXML (.xml / .musicxml / .mxl) y MIDI (.mid). En MIDI se selecciona automáticamente la pista más cercana al registro del instrumento.',
      'Toca cualquier nota para cambiar su digitación. Los cambios se guardan en tu dispositivo automáticamente y se pueden exportar para llevarlos a otro.',
      'Puedes cambiar el tempo, añadir una cuenta de cuatro al empezar y repetir en bucle los compases que elijas.',
      'El afinador detecta la altura con el micrófono y muestra la desviación en cents junto con el nivel de entrada.',
      'Puedes alternar entre diapasón y partitura, mostrar las líneas de trastes, ampliar el diapasón y usar la pantalla en horizontal.',
    ],
    'use_title' => 'Cómo se usa',
    'steps' => [
      'Elige un modo de práctica con los botones de arriba.',
      'Para escalas, elige tonalidad y octavas; para piezas, elige una canción o carga una partitura.',
      'Pulsa reproducir: sonarán las notas y verás dónde está cada una en el diapasón.',
    ],
    'faq_title' => 'Preguntas frecuentes',
    'faqs' => [
      ['¿Hay que instalar algo?', 'No. Funciona en el navegador. Las partituras que cargues y las digitaciones que edites se guardan en tu dispositivo y no se envían a ningún sitio.'],
      ['El micrófono no funciona', 'El micrófono solo funciona en https:// o localhost. No funciona con una URL file:// ni si no has dado permiso en el navegador.'],
      ['¿Qué archivos de partitura puedo usar?', 'MusicXML (.xml / .musicxml / .mxl) y MIDI (.mid). El PDF se muestra solo como referencia; no se leen las notas de la imagen.'],
      ['¿Puedo cambiar la digitación?', 'Toca una nota y aparecerán las alternativas. Tu elección se guarda automáticamente y puede exportarse e importarse.'],
    ],
    'note'  => 'Todo el proceso ocurre en tu dispositivo. No se envía ningún dato al exterior.',
  ],

  'soon' => [
    'title' => 'La versión para %s está en preparación',
    'body'  => 'Todavía no está disponible. Vuelve a consultarlo más adelante.',
    'back'  => 'Abrir la versión para %s',
  ],
];
