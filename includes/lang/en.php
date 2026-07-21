<?php
/*
  includes/lang/en.php — English. Mirror of ja.php; keep the same keys.
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

return [
  'html_lang'  => 'en',
  'name'       => 'English',

  'note_names' => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],

  'zone' => [
    'open'       => 'Open',
    'low'        => 'Low',
    'mid'        => 'Mid',
    'high'       => 'High',
    'high_thumb' => 'High (thumb)',
  ],
  'finger' => [
    'open'  => '0',
    'thumb' => 'T',
  ],
  'instrument' => [
    'cello'  => 'Cello',
    'violin' => 'Violin',
    'viola'  => 'Viola',
  ],

  'page_title' => '%s practice app | fingerboard positions, fingering and tuner',
  'app_sub'    => '%s practice app',

  'ui' => [
    'menu'           => 'Menu',
    'nowline'        => 'Open a score',
    'gear_aria'      => 'Fingerboard display settings',
    'close'          => 'Close',
    'settings'       => '⚙ Settings',
    'lang_label'     => 'Language / 言語',
    'lang_note'      => 'Selecting a language opens that version of the page',

    'view'           => 'View',
    'view_board'     => '🎻 Fingerboard',
    'view_staff'     => '🎼 Staff',
    'frets'          => 'Show fret lines',
    'landscape'      => 'Landscape',
    'landscape_note' => 'The staff view is easier to read in landscape',

    'playback'       => 'Playback',
    'countin'        => '4-beat count-in',
    'keepawake'      => 'Keep screen awake while playing',

    'zoom'           => 'Fingerboard zoom',
    'zoom_k'         => 'Scale',
    'zoom_fit'       => 'Fit',
    'zoom_reset'     => '100%',

    'volume'         => 'Volume',
    'vol_master'     => 'Master',
    'vol_lead'       => 'Melody',
    'vol_drum'       => 'Drums',
    'vol_bass'       => 'Bass',
    'vol_chord'      => 'Chords',
    'vol_metro'      => 'Metronome',
    'vol_reset'      => 'Reset volumes',

    'empty_t'        => 'Load a score',
    'empty_s'        => '→ open a score or pick a song',

    'mode_scale'     => 'Scale practice',
    'mode_scale_s'   => 'Fundamentals',
    'mode_score'     => 'Practise a piece',
    'mode_score_s'   => 'Pick a song (or load a score file)',
    'mode_tuner'     => 'Tuner',
    'mode_tuner_s'   => 'Real-time pitch detection',
    'mode_game'      => 'Mini game',
    'mode_game_s'    => 'Coming soon',

    'fab_aria'       => 'Play / Stop',
    'dk_tempo_aria'  => 'Tempo settings',
    'dk_enjoy_aria'  => 'Backing track ON/OFF',
    'dk_enjoy'       => 'Backing',
    'dk_oct_aria'    => 'Octave settings',
    'dk_oct_auto'    => 'Auto',
    'dk_loop_aria'   => 'Loop settings',
    'dk_loop'        => 'Loop',

    'm_tempo'        => '⏱ Tempo',
    'tempo_k'        => 'Speed',
    'm_oct'          => 'Oct Octave',
    'oct_auto'       => 'Auto',
    'oct_orig'       => 'Original',
    'm_loop'         => '🔁 Loop settings',
    'm_inst'         => '🎻 Choose an instrument',
    'inst_soon'      => 'Coming soon',
    'loop_sw'        => 'Loop playback',
    'loop_from'      => 'From bar',
    'loop_to'        => 'To bar',
    'loop_info'      => 'Repeats the bars you specify (e.g. 34–40)',

    'seg_scale'      => '🎵 Scales',
    'seg_score'      => '🎼 Pieces',
    'seg_tuner'      => '🎯 Tuner',

    'mic'            => 'Microphone',
    'mic_sw'         => 'Detect pitch with the microphone',
    'mic_note1'      => 'The note you play is shown on the fingerboard.',
    'mic_note2'      => 'The microphone only works over https:// or localhost (not file://).',

    'scale_set'      => 'Scale settings',
    'key'            => 'Key',
    'octave'         => 'Octaves',
    'scale'          => 'Scale',
    'scale_pop'      => '🎵 Pop (major)',

    'sub_songs'      => '🎵 Pick a song',
    'sub_load'       => '📂 Load a score',
    'songs'          => 'Pick a song',
    'songs_loading'  => '🎼 Loading…',
    'songs_note'     => 'Choosing a song loads its score',

    'score'          => 'Score',
    'file_open'      => '🎼 Open',
    'pdf_btn'        => '📄 PDF',
    'file_note'      => 'Supports MusicXML (.xml/.musicxml/.mxl) and MIDI (.mid)',
    'tracks'         => 'MIDI track',
    'skip_start'     => '⏭ Skip to first note',
    'tracks_note'    => 'Tap a track name to hear it. The track closest to the %s range is preselected.',

    'pref'           => 'Preferred position',

    'fing_save'      => 'Saved fingering',
    'fing_export'    => 'Export',
    'fing_import'    => 'Import',
    'fing_reset'     => 'Reset',
    'fing_note'      => 'Edited fingering is saved automatically',

    'scale_gen'      => 'Generate scale',

    'drawer_note_html' => 'Stopping positions are derived from the string-length ratio (1 − 2<sup>−semitones/12</sup>). Position names and finger numbers are a guide only.<br>Everything runs locally; no data leaves your device.',

    'pdf_open'       => '📄 Open',
    'pdf_note_html'  => 'PDF is <b>for reference only</b>. Optical music recognition is not possible in the browser alone, so fingering and playback data are imported from MusicXML.',
    'pdf_empty'      => 'Choose a PDF file to display it here',

    'tuner_t'        => 'Tuner / pitch detection',
    'tun_in'         => 'Input level',
    'tun_in_note'    => 'Adjust the distance to the microphone and the input volume to stay inside the green band',

    'edit_t'         => '👇 You can change the fingering',
    'edit_empty'     => 'Select a note to edit its fingering',
  ],

  'intro' => [
    'title' => 'About this app',
    'lead'  => 'A web app that puts a %s fingerboard on your phone screen so you can check stopping positions, finger numbers and pitch while you practise. Nothing to install — it runs in the browser.',
    'items' => [
      ['🎵', 'Scale practice',  'Pick a key and a number of octaves and the scale is laid out on the fingerboard and the staff, with a backing track and metronome.'],
      ['🎼', 'Practise a piece', 'Choose one of the bundled songs, or load MusicXML / MIDI, to get a score with fingering. Tap to change any fingering.'],
      ['🎯', 'Tuner',            'Detects pitch through the microphone and shows where the note you are playing sits on the fingerboard.'],
    ],
    'feat_title' => 'What it does',
    'feats' => [
      'Stopping positions are calculated from the string-length ratio. Position names (open, low, mid, high) and finger numbers are shown as a guide.',
      'Pick a key and a number of octaves and the scale is laid out on both the fingerboard and the staff, with a backing track (drums, bass, chords) and a metronome.',
      'Scores can be loaded from MusicXML (.xml / .musicxml / .mxl) and MIDI (.mid). For MIDI, the track closest to the instrument range is selected automatically.',
      'Tap any note to change its fingering. Edits are saved on your device automatically, and can be exported to move to another device.',
      'The tempo can be changed, with an optional four-beat count-in and loop playback over a chosen range of bars.',
      'The tuner detects pitch through the microphone and shows the deviation in cents along with the input level.',
      'You can switch between fingerboard and staff view, show fret lines, zoom the fingerboard, and use a landscape layout.',
    ],
    'use_title' => 'How to use it',
    'steps' => [
      'Choose a practice mode from the buttons above.',
      'For scales, pick a key and a number of octaves; for pieces, pick a song or load a score file.',
      'Press play — you will hear the notes and see where each one sits on the fingerboard.',
    ],
    'faq_title' => 'Questions',
    'faqs' => [
      ['Do I need to install anything?', 'No. It runs in the browser. Scores you load and fingerings you edit are stored on your device and are never sent anywhere.'],
      ['The microphone does not work', 'The microphone only works over https:// or localhost. It will not work from a file:// URL, or if the browser has not been given permission.'],
      ['Which score files can I use?', 'MusicXML (.xml / .musicxml / .mxl) and MIDI (.mid). PDF is displayed for reference only; notes are not read from the image.'],
      ['Can I change the fingering myself?', 'Tap a note and the alternatives appear. Your choice is saved automatically, and can be exported and imported.'],
    ],
    'note'  => 'Everything runs on your device. No data is sent anywhere.',
  ],

  'soon' => [
    'title' => 'The %s version is in preparation',
    'body'  => 'This version is not ready yet. Please check back later.',
    'back'  => 'Open the %s version',
  ],
];
