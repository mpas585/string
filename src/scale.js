/*
  scale.js — スケール定義と生成ロジック。元 cello-finger.html L2187–2245 より無改変で移植。
    SCALES / SCALE_LABEL / isMinorScale … L2188–2200
    buildScaleEvents                    … L2202–2235（recommend＝fingerboard を使用）
    progressionFor（エンジョイ用4コード） … L2237–2245（scheduler が使用）
  ※ genScale（L3067, 統括＝setScore/startPlay 依存）は Batch5 へ。
  ※ SCALES/SCALE_LABEL は現状コード内。外部化フォーマットは public/scales/scales.json に用意済み。
    実 fetch 差し替え（loadScales）は初期化フローの都合で Batch5（genScale 統括と同時）。
*/
import { OPEN, midiName } from './util.js';
import { recommend } from './fingerboard.js';

/* ===== スケール生成 ===== */
export const SCALES = {
  pop:     [0,2,4,5,7,9,11]      /* メジャー */
};
export const SCALE_LABEL = {
  pop:'ポップス（メジャー）'
};
/* 3度の有無で長短判定（陰旋法など3度を持たない音階はマイナー扱い） */
export function isMinorScale(type){
  const st=SCALES[type] || SCALES.pop;
  if(st.includes(3)) return true;
  if(st.includes(4)) return false;
  return true;
}

export function buildScaleEvents(rootPc, type, octaves){
  const steps=SCALES[type] || SCALES.pop;
  const root = 36 + (((rootPc % 12) + 12) % 12);   /* C2(36) 以上の最低ルート */
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
