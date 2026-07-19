/*
  scale.js — スケール定義と生成ロジック。元 cello-finger.html L2187–2245 より無改変で移植。
    SCALES / SCALE_LABEL / isMinorScale … L2188–2200
    buildScaleEvents                    … L2202–2235（recommend＝fingerboard を使用）
    progressionFor（エンジョイ用4コード） … L2237–2245（scheduler が使用）
  ※ genScale（L3067, 統括＝setScore/startPlay 依存）は modes.js。
  ※ SCALES/SCALE_LABEL は public/scales/scales.json から loadScales() で読み込む（外部化済み）。
    main.js の初期化で loadSettings() より先に await すること（保存済み scaleType の照合に必要）。
*/
import { OPEN, midiName } from './util.js';
import { recommend } from './fingerboard.js';
import { ST } from './state.js';

/* ===== スケール定義（public/scales/scales.json から外部読み込み） ===== */
/* fetch できない環境（file:// 等）で無音にならないための最終手段。 */
export const FALLBACK_SCALES = [
  {id:'pop', label:'ポップス（メジャー）', intervals:[0,2,4,5,7,9,11]}
];
export const SCALES = {};        /* id -> intervals（loadScales で充填） */
export const SCALE_LABEL = {};   /* id -> 表示名（loadScales で充填） */

/* 定義を差し替え、スケール選択の <select> も作り直す */
export function setScales(list){
  for(const k of Object.keys(SCALES))      delete SCALES[k];
  for(const k of Object.keys(SCALE_LABEL)) delete SCALE_LABEL[k];
  list.forEach(s=>{
    if(!s || !s.id || !Array.isArray(s.intervals) || !s.intervals.length) return;
    SCALES[s.id]=s.intervals.slice();
    SCALE_LABEL[s.id]=s.label || s.id;
  });
  const ids=Object.keys(SCALES);
  const sel=document.getElementById('scaleType');
  if(sel) sel.innerHTML=ids.map(id=>`<option value="${id}">🎵 ${SCALE_LABEL[id]}</option>`).join('');
  if(!SCALES[ST.scaleType] && ids.length) ST.scaleType=ids[0];
}
export const SCALES_URL = new URL('../public/scales/scales.json', import.meta.url);
export async function loadScales(){
  try{
    const res=await fetch(SCALES_URL, {cache:'no-cache'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const j=await res.json();
    if(!j || !Array.isArray(j.scales) || !j.scales.length) throw new Error('scales が空です');
    setScales(j.scales);
  }catch(e){
    setScales(FALLBACK_SCALES);
    console.error('[cello] scales.json を読み込めません：', e);
  }
}
/* 音階の音程列（未ロード・未定義でも落ちないように） */
export function stepsOf(type){
  return SCALES[type] || SCALES.pop || FALLBACK_SCALES[0].intervals;
}
/* 3度の有無で長短判定（陰旋法など3度を持たない音階はマイナー扱い） */
export function isMinorScale(type){
  const st=stepsOf(type);
  if(st.includes(3)) return true;
  if(st.includes(4)) return false;
  return true;
}

/* 推奨ポジション（ロー/ミドル/ハイ）に合わせて開始音のオクターブを選ぶ。
   C2 のように開放弦でしか鳴らせない音から始めると、「ハイ」を選んでいても
   ローポジションから始まってしまうため。1オクターブ以上入る中で、
   指定ゾーンに該当する一番低い開始音を使う。 */
export function startRoot(rootPc){
  const pc = (((rootPc % 12) + 12) % 12);
  const lowest = 36 + pc;                          /* C2(36) 以上の最低ルート */
  const maxMidi = OPEN[3] + 26;                    /* A線26半音 = 演奏可能な上限 */
  const want = (ST.pref==='high') ? 'high' : (ST.pref==='mid') ? 'mid' : 'low';
  for(let m=lowest; m+12<=maxMidi; m+=12){
    const r=recommend(m);
    if(r && r.klass===want) return m;
  }
  return lowest;                                   /* 該当が無ければ従来どおり最低ルート */
}

export function buildScaleEvents(rootPc, type, octaves){
  const steps=stepsOf(type);
  const root = startRoot(rootPc);                  /* 推奨ポジションに応じた開始音 */
  const maxMidi = OPEN[3] + 26;                    /* A線26半音 = 演奏可能な上限 */

  /* 1オクターブ = 「ド〜ド」で完結する run（＝メジャーなら8音＝8拍）
     境界のドは前の run の終点と次の run の始点で 2回鳴る            */
  const runs=[];
  for(let o=0;o<octaves;o++){
    const top = root + (o+1)*12;
    if(top > maxMidi) break;                       /* 音域外の run は作らない */
    const run=[];
    for(const s of steps) run.push(root + o*12 + s);
    run.push(top);
    runs.push(run);
  }
  if(!runs.length) throw new Error('この設定では音域外です。オクターブを減らしてください。');

  const seq=[];
  runs.forEach(r=> seq.push(...r));                                  /* 上行：ド〜ド × N */
  [...runs].reverse().forEach(r=> seq.push(...[...r].reverse()));    /* 下行：ド〜ド × N */

  const evs = seq.map((m,i)=>{
    const p={midi:m, name:midiName(m)};
    return {id:i, measure:Math.floor(i/4)+1, onset:i, dur:1, pitches:[p], leadIdx:0, fing:null};
  });
  evs.forEach(e=>{ e.fing = recommend(e.pitches[0].midi); });

  const maxM=Math.ceil(seq.length/4);
  const measures=[];
  for(let m=1;m<=maxM;m++) measures.push({num:m, start:(m-1)*4, end:m*4});

  return {events:evs, measures, beatsPerMeasure:4};
}

/* ===== エンジョイモード：4コード進行 ===== */
export function progressionFor(rootPc, type){
  const isMinor = isMinorScale(type);
  const r=((rootPc%12)+12)%12;
  if(isMinor){
    return [ {root:r, q:'min'}, {root:(r+8)%12, q:'maj'}, {root:(r+3)%12, q:'maj'}, {root:(r+10)%12, q:'maj'} ];
  }
  return [ {root:r, q:'maj'}, {root:(r+7)%12, q:'maj'}, {root:(r+9)%12, q:'min'}, {root:(r+5)%12, q:'maj'} ];
}
