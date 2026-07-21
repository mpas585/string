/*
  util.js — 純粋関数と楽器の基礎定数。
  他モジュールに依存しない末端。元 cello-finger.html より移植。
    NOTE_NAMES/OPEN/STRNAME/midiName/fracOf … L945–950
    zoneOf/FINGER_TABLE/fingerHint            … L1024–1036
  ※ 多楽器・多言語対応にあたり、定数の実値だけを PHP（config/*.php・includes/lang/*.php）
     から window.INSTRUMENT / window.APP 経由で受け取るようにした。関数の挙動は元のまま。
*/

/* ===== 定数：楽器定義 =====
   値の出所は config/{楽器}.php（PHPが window.INSTRUMENT / window.APP に出力）。
   未注入のとき（PHPを通さず開いたとき）は従来どおりチェロ・日本語で動く。 */
const INST = (typeof window!=='undefined' && window.INSTRUMENT) ? window.INSTRUMENT : {};
const APPC = (typeof window!=='undefined' && window.APP) ? window.APP : {};

/* 楽器ID。保存キーの名前空間などに使う */
export const INSTRUMENT_ID = INST.id || 'cello';

/* 開放弦 (チェロ: C2 G2 D3 A3) */
export const OPEN = INST.open || [36, 43, 50, 57];
export const STRNAME = INST.strnames || ['C','G','D','A'];
export const NOTE_NAMES = APPC.noteNames || ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function midiName(m){ return NOTE_NAMES[((m%12)+12)%12] + (Math.floor(m/12)-1); }
export function fracOf(off){ return 1 - Math.pow(2, -off/12); }

/* ===== ゾーン & 指の目安 ===== */
/* [{maxOff, zone, klass}] を上から順に見て最初に収まった帯を返す。maxOff:null は最後まで。
   klass('low'|'mid'|'high') は推奨ポジションの判定に使う内部値なので変えないこと。 */
export const ZONES = INST.zones || [
  {maxOff:0,    zone:'開放',        klass:'low'},
  {maxOff:7,    zone:'ロー',        klass:'low'},
  {maxOff:13,   zone:'ミドル',      klass:'mid'},
  {maxOff:null, zone:'ハイ(親指P)', klass:'high'}
];
export function zoneOf(off){
  for(const z of ZONES){ if(z.maxOff==null || off<=z.maxOff) return {zone:z.zone, klass:z.klass}; }
  const last=ZONES[ZONES.length-1];
  return {zone:last.zone, klass:last.klass};
}
export const FINGER_TABLE = INST.fingerTable || {0:'開',1:'1',2:'1',3:'2',4:'3',5:'4',6:'2',7:'1',8:'1',9:'2',10:'3',11:'4',12:'1'};
export const FINGER_HIGH = INST.fingerHigh || '親';
export function fingerHint(off){
  if(off in FINGER_TABLE) return FINGER_TABLE[off];
  if(off>12) return FINGER_HIGH;
  return '?';
}
