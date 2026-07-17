/*
  util.js — 純粋関数と楽器の基礎定数。
  他モジュールに依存しない末端。元 cello-finger.html より無改変で移植。
    NOTE_NAMES/OPEN/STRNAME/midiName/fracOf … L945–950
    zoneOf/FINGER_TABLE/fingerHint            … L1024–1036
*/

/* ===== 定数：チェロ開放弦 (C2 G2 D3 A3) ===== */
export const OPEN = [36, 43, 50, 57];
export const STRNAME = ['C','G','D','A'];
export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function midiName(m){ return NOTE_NAMES[((m%12)+12)%12] + (Math.floor(m/12)-1); }
export function fracOf(off){ return 1 - Math.pow(2, -off/12); }

/* ===== ゾーン & 指の目安 ===== */
export function zoneOf(off){
  if(off===0) return {zone:'開放', klass:'low'};
  if(off<=7)  return {zone:'ロー', klass:'low'};
  if(off<=13) return {zone:'ミドル', klass:'mid'};
  return {zone:'ハイ(親指P)', klass:'high'};
}
export const FINGER_TABLE = {0:'開',1:'1',2:'1',3:'2',4:'3',5:'4',6:'2',7:'1',8:'1',9:'2',10:'3',11:'4',12:'1'};
export function fingerHint(off){
  if(off in FINGER_TABLE) return FINGER_TABLE[off];
  if(off>12) return '親';
  return '?';
}
