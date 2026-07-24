<?php
/*
  midi.php — MIDIノート番号まわりの共通処理（楽器・言語に依存しない部分）。
  JS 側 src/util.js の midiName / fracOf と同じ規則を PHP でも持つ。
*/
if (!defined('STRING_APP')) { http_response_code(403); exit; }

/* 既定の音名（英米式）。言語ファイルの 'note_names' で差し替えられる。
   例：スペイン語圏の Do Re Mi 表記にしたい場合は includes/lang/es.php の
       note_names を ['Do','Do#','Re',...] に書き換える。 */
const MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* 言語ファイルから音名を取り出す（12個そろっていなければ既定値） */
function midi_note_names(array $lang): array {
  $n = $lang['note_names'] ?? null;
  return (is_array($n) && count($n) === 12) ? array_values($n) : MIDI_NOTE_NAMES;
}

/* MIDIノート番号 → 音名＋オクターブ（C2, A3 など）。JS の midiName と同じ */
function midi_name(int $midi, ?array $names = null): string {
  $names = $names ?: MIDI_NOTE_NAMES;
  $pc = (($midi % 12) + 12) % 12;
  return $names[$pc] . ((int)floor($midi / 12) - 1);
}

/* MIDIノート番号 → 周波数(Hz)。A4=440 */
function midi_freq(float $midi): float {
  return 440.0 * pow(2, ($midi - 69) / 12);
}

/* 開放弦からの半音数 → 弦長比（1 − 2^(−半音/12)）。JS の fracOf と同じ */
function midi_frac(float $off): float {
  return 1 - pow(2, -$off / 12);
}

/* 開放弦の音名一覧（チューナー表示用。チェロなら ['C2','G2','D3','A3']） */
function midi_open_labels(array $inst, array $names): array {
  $out = [];
  foreach ($inst['open'] as $m) { $out[] = midi_name((int)$m, $names); }
  return $out;
}
