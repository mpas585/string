/*
  audio/context.js — 永続 AudioContext / ノイズ源 / 音量バス。
  元 cello-finger.html より無改変で移植。
    makeNoise            … L2320–2326
    AUD/IRBUF/NOISEBUF, audio, warmAudio … L2515–2529
    makeBuses            … L2530–2552
    applyVolumes         … L2553–2559
  ※ AUD/IRBUF/NOISEBUF は export let（ライブバインディング）。
    再生開始側（scheduler の startPlay）は NOISEBUF を読み取って ST.noise へ渡す。
*/

import { ST } from '../state.js';
import { makeReverbIR } from './ir.js';

export function makeNoise(ctx){
  const len=Math.floor(ctx.sampleRate*0.5);
  const b=ctx.createBuffer(1, len, ctx.sampleRate);
  const d=b.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
  return b;
}

/* ===== 永続 AudioContext（毎回作り直さない＝クリック音の元を断つ） ===== */
export let AUD=null, IRBUF=null, NOISEBUF=null;
export function audio(){
  if(!AUD){
    const AC=window.AudioContext||window.webkitAudioContext;
    /* 'playback' = 大きめのバッファ。音は全て先読み予約なので遅延は問題にならない */
    try{ AUD=new AC({latencyHint:'playback'}); }catch(e){ AUD=new AC(); }
  }
  if(AUD.state==='suspended'){ try{ AUD.resume(); }catch(e){} }
  if(!NOISEBUF) NOISEBUF=makeNoise(AUD);
  if(!IRBUF)    IRBUF=makeReverbIR(AUD, 1.3, 3);
  return AUD;
}
/* 再生前に音源を用意（初回再生時の重い初期化を前倒し） */
export function warmAudio(){ try{ audio(); }catch(e){} }
/* 出力の底上げ。ST.vol.master は 0〜1 のユーザー音量なので、そこへこの係数を掛けてから
   リミッターに通す。単純にゲインを上げるだけだとピークが割れるので、
   リミッターとセットで「歪ませずに音圧だけ上げる」。 */
export const MASTER_BOOST=2.4;
export function makeLimiter(ctx){
  const l=ctx.createDynamicsCompressor();
  l.threshold.value=-3;    /* この上を叩く */
  l.knee.value=0;          /* ハードリミット */
  l.ratio.value=20;
  l.attack.value=0.003;
  l.release.value=0.15;
  return l;
}
/* 音量バス。チェロの胴鳴りは「楽器の性質」なので1音ごとではなくバスに置く（CPU大幅削減） */
export function makeBuses(ctx){
  const limiter=makeLimiter(ctx); limiter.connect(ctx.destination);
  const master=ctx.createGain(); master.gain.value=ST.vol.master*MASTER_BOOST; master.connect(limiter);
  const conv=ctx.createConvolver(); conv.buffer=IRBUF;
  const wet=ctx.createGain(); wet.gain.value=0.28;
  conv.connect(wet); wet.connect(master);
  const mk=(v, send)=>{
    const g=ctx.createGain(); g.gain.value=v; g.connect(master);
    if(send>0){ const sg=ctx.createGain(); sg.gain.value=send; g.connect(sg); sg.connect(conv); }
    return g;
  };
  const leadOut=mk(1.0, 0.55);
  const b1=ctx.createBiquadFilter(); b1.type='peaking'; b1.frequency.value=225;  b1.Q.value=1.2; b1.gain.value=7;
  const b2=ctx.createBiquadFilter(); b2.type='peaking'; b2.frequency.value=460;  b2.Q.value=1.5; b2.gain.value=4.5;
  const b3=ctx.createBiquadFilter(); b3.type='peaking'; b3.frequency.value=1350; b3.Q.value=1.8; b3.gain.value=3;
  const leadIn=ctx.createGain(); leadIn.gain.value=ST.vol.lead;
  leadIn.connect(b1); b1.connect(b2); b2.connect(b3); b3.connect(leadOut);
  return {master, limiter, conv, wet, lead:leadIn,
    drum : mk(ST.vol.drum , 0.10),
    bass : mk(ST.vol.bass , 0.06),
    chord: mk(ST.vol.chord, 0.42),
    metro: mk(ST.vol.metro, 0)};
}
export function applyVolumes(){
  if(!ST.buses || !ST.ctx) return;
  const t=ST.ctx.currentTime;
  for(const k of ['master','lead','drum','bass','chord','metro']){
    const v = (k==='master') ? ST.vol[k]*MASTER_BOOST : ST.vol[k];
    try{ ST.buses[k].gain.setTargetAtTime(v, t, 0.02); }catch(e){}
  }
}
