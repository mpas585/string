/*
  audio/scheduler.js — 再生エンジン（先読みスケジューリング・トランスポート・シーク）。
  元 cello-finger.html より無改変で移植。
    totalBeats/measureOfBeat/updateTransport … L1665–1688
    renderSeekBand〜seekTo（シークバー/トランスポートtick）… L1734–1824
    scheduleMetro/scheduleBar/loopActive/playRange … L2446–2513
    LOOKAHEAD/SCHED_TICK, stopPlay, showCount/hideCount, acquireWake/releaseWake,
    startPlay, fillQueue, pumpQueue … L2562–2712
    currentBeat/tempoTimer/setTempo … L2922–2944
  依存: state, synth（playNote/bassNote/drKick/drSnare/drHat/metroClick/padChord）,
        context（audio/makeBuses）, fingerboard（paintNotes/pluckEvent/scrollBoardToActive）,
        notation（updateStaffActive/scrollStaffToActive）, scale（progressionFor）, dom（toast）,
        modes（render/renderNow/updateChrome/renderStrip/updateStripActive/scrollStripToActive/mq）。
  ※ modes は Batch5 後半で作成。それまで実行時は未解決（構文・元一致は検証済み）。
*/
import { ST } from '../state.js';
import { playNote, bassNote, drHat, drKick, drSnare, metroClick, padChord } from './synth.js';
import { audio, makeBuses } from './context.js';
import { paintNotes, pluckEvent, scrollBoardToActive } from '../fingerboard.js';
import { updateStaffActive, scrollStaffToActive } from '../notation.js';
import { progressionFor } from '../scale.js';
import { toast } from '../dom.js';
import { render, renderNow, updateChrome, renderStrip, updateStripActive, scrollStripToActive, mq } from '../modes.js';

export function totalBeats(){
  if(!ST.events.length) return 1;
  let t = Math.max(...ST.events.map(e=> e.onset + e.dur));
  if(ST.measures.length) t = Math.max(t, ST.measures[ST.measures.length-1].end);
  return Math.max(t, 1);
}
export function measureOfBeat(beat){
  const ms=ST.measures;
  if(!ms.length) return 1;
  for(let i=0;i<ms.length;i++){ if(beat < ms[i].end - 1e-6) return ms[i].num; }
  return ms[ms.length-1].num;
}
export function updateTransport(){
  const show = (ST.mode==='scale' || ST.mode==='score') && ST.events.length>0;
  document.body.classList.toggle('has-tp', show);
  if(!show) return;
  renderStrip();
  renderSeekBand();
  if(!ST.playing){
    const id = (ST.selected!=null) ? ST.selected : 0;
    const ev = ST.events[id];
    setSeekHead(ev ? ev.onset : 0);
  }
}

export function renderSeekBand(){
  const total=totalBeats();
  const band=document.getElementById('seekLoop');
  const ms=ST.measures;
  if(loopActive() && ST.mode==='score'){
    const f=Math.max(1, Math.min(ST.loop.from, ms.length));
    const t=Math.max(f, Math.min(ST.loop.to, ms.length));
    const sB=ms[f-1].start, eB=ms[t-1].end;
    band.style.display='block';
    band.style.left=(sB/total*100)+'%';
    band.style.width=((eB-sB)/total*100)+'%';
  } else {
    band.style.display='none';
  }
  document.getElementById('tmTotal').textContent='/ '+(ms.length || 1);
}
export function setSeekHead(beat){
  const total=totalBeats();
  const pct=Math.max(0, Math.min(100, beat/total*100));
  document.getElementById('seekFill').style.width=pct+'%';
  document.getElementById('seekHead').style.left=pct+'%';
  document.getElementById('tmCur').textContent=measureOfBeat(beat);
}
/* 再生中の位置更新 */
export function transportTick(){
  if(!ST.playing || !ST.ctx || !ST.range){ ST.seekRaf=0; return; }
  ST.seekRaf=requestAnimationFrame(transportTick);
  const beat=currentBeat();
  setSeekHead(Math.max(0, Math.min(totalBeats(), beat)));

  /* 現在鳴っている音符（変化した時だけ再描画＝毎音の setTimeout+render を廃止） */
  let cur=null;
  const list=ST.range.list;
  for(let i=list.length-1;i>=0;i--){
    if(list[i].onset <= beat + 1e-6){ cur=list[i].id; break; }
  }
  if(cur!==ST.current){
    ST.current=cur; ST.selected=null;
    const ev=(cur!=null) ? ST.events[cur] : null;
    /* 軽量更新：SVG全体やドロワーは作り直さない */
    paintNotes(ev);
    renderNow(ev);
    updateStripActive();
    scrollStripToActive();
    scrollBoardToActive();
    if(ST.view==='staff'){ updateStaffActive(); scrollStaffToActive(); }
    pluckEvent(ev);
  }
}
/* シーク（タップ／ドラッグで再生位置調整） */
/* 90度回転中は「要素の横方向」が画面の縦方向に対応する */
export function isRotated(){
  if(!document.body.classList.contains('force-landscape')) return false;
  const m=mq('(orientation: portrait)');
  return m ? m.matches : (window.innerHeight >= window.innerWidth);
}
export function beatFromSeekEvent(e){
  const el=document.getElementById('seek');
  const rect=el.getBoundingClientRect();
  const rot=isRotated();
  const span = rot ? rect.height : rect.width;
  if(!span) return 0;
  const pos  = rot ? (e.clientY - rect.top) : (e.clientX - rect.left);
  const pct=Math.max(0, Math.min(1, pos/span));
  let beat=pct*totalBeats();
  const ms=ST.measures;
  if(loopActive() && ST.mode==='score'){
    const f=Math.max(1, Math.min(ST.loop.from, ms.length));
    const t=Math.max(f, Math.min(ST.loop.to, ms.length));
    beat=Math.max(ms[f-1].start, Math.min(ms[t-1].end - 0.001, beat));
  }
  return beat;
}
export function seekTo(beat){
  if(!ST.events.length) return;
  let idx=0, best=Infinity;
  ST.events.forEach((ev,i)=>{
    const d=Math.abs(ev.onset - beat);
    if(d<best){ best=d; idx=i; }
  });
  ST.playhead=beat;                    /* ★ 次の ▶ はここから始める */
  if(ST.playing){
    startPlay(beat, true);
  } else {
    ST.selected=idx; ST.current=null;
    render();
    scrollBoardToActive();
    scrollStripToActive();
  }
  setSeekHead(beat);
}

export function scheduleMetro(ctx, bus, tBar, bs, beats){
  const n=Math.max(1, Math.round(beats));
  for(let i=0;i<n;i++) metroClick(ctx, bus, tBar + i*bs, i===0);
}

/* 1小節ぶんの伴奏（next = 次のコード。ベースのアプローチ音に使う） */
export function scheduleBar(ctx, B, tBar, bs, chord, next, beats){
  const n=Math.max(1, Math.round(beats));

  /* --- ドラム --- */
  for(let i=0;i<n;i++){
    const t=tBar+i*bs;
    if(i%2===0) drKick(ctx, B.drum, t); else drSnare(ctx, B.drum, t);
    drHat(ctx, B.drum, t, false);
    drHat(ctx, B.drum, t+bs*0.5, i===n-1);
  }
  if(n>=4){
    drKick(ctx, B.drum, tBar+bs*2.5);        /* 3拍ウラのキック */
  }

  /* --- ベース：8分刻み・スタッカート --- */
  const R = 36 + chord.root;              /* C2〜B2 */
  const nextR = 36 + (next ? next.root : chord.root);
  const approach = (nextR === R) ? R : (nextR > R ? nextR - 1 : nextR + 1);
  const eighths = n*2;
  const GATE = 0.24;                      /* 8分(0.5拍)のうち鳴らす長さ＝スタッカート */
  for(let i=0;i<eighths;i++){
    const t = tBar + i*0.5*bs;
    const last = (i === eighths-1);
    const m = last ? approach : R;        /* 最後の8分だけ次のコードへ半音アプローチ */
    const v = (i%2===0) ? 1.0 : 0.62;     /* 表拍を強く＝刻みのノリ */
    bassNote(ctx, B.bass, t, GATE*bs, m, v);
  }

  /* --- コード：ピアノで打鍵（小節頭＋中間で弱く） --- */
  const third = (chord.q==='min') ? 3 : 4;
  const voic  = [48+chord.root, 60+chord.root, 60+chord.root+third, 60+chord.root+7];
  padChord(ctx, B.chord, tBar, n*bs*0.98, voic);
  if(n>=4) padChord(ctx, B.chord, tBar+bs*2, n*bs*0.5, voic.slice(1));
}

/* --- 再生範囲（ループ小節指定） --- */
export function loopActive(){
  return ST.loop.on && ST.measures.length>0;
}
export function playRange(){
  const ms=ST.measures;
  let sB=0, eB=0;
  if(loopActive()){
    if(ST.mode==='scale'){
      /* スケール練習：小節指定なし。常にスケール全体をループ */
      sB=0;
      eB=ms[ms.length-1].end;
    } else {
      const from=Math.max(1, Math.min(ST.loop.from|0, ms.length));
      const to  =Math.max(from, Math.min(ST.loop.to|0, ms.length));
      sB=ms[from-1].start;
      eB=ms[to-1].end;
    }
  } else {
    sB=0;
    eB=Math.max(...ST.events.map(e=> e.onset+e.dur));
    if(ms.length) eB=Math.max(eB, ms[ms.length-1].end);
  }
  if(eB<=sB) eB=sB+ST.beatsPerMeasure;
  const list=ST.events.filter(e=> e.onset >= sB-1e-6 && e.onset < eB-1e-6);
  return {sB, eB, list};
}

export const LOOKAHEAD = 0.85;   /* 秒：メインスレッドが数百ms止まっても音が途切れない */
export const SCHED_TICK = 50;    /* ms */

export function stopPlay(){
  if(ST.schedTimer){ clearInterval(ST.schedTimer); ST.schedTimer=0; }
  if(ST.seekRaf){ cancelAnimationFrame(ST.seekRaf); ST.seekRaf=0; }
  ST.timers.forEach(t=>clearTimeout(t)); ST.timers=[];
  if(ST.buses && ST.ctx){
    const t=ST.ctx.currentTime, m=ST.buses.master, B=ST.buses;
    try{
      m.gain.cancelScheduledValues(t);
      m.gain.setValueAtTime(m.gain.value, t);
      m.gain.linearRampToValueAtTime(0.0001, t+0.05);
    }catch(e){}
    setTimeout(()=>{ try{ m.disconnect(); B.conv.disconnect(); }catch(e){} }, 250);
  }
  ST.buses=null; ST.master=null; ST.range=null; ST.queue=[];
  ST.playing=false; ST.current=null;
  hideCount(); releaseWake();
  render();
}

/* ===== 冒頭4カウント ===== */
export function showCount(n){
  const el=document.getElementById('countin'), sp=document.getElementById('countnum');
  sp.textContent=n;
  el.classList.add('show');
  sp.style.animation='none'; void sp.offsetWidth; sp.style.animation='';
}
export function hideCount(){ document.getElementById('countin').classList.remove('show'); }

/* ===== スリープ防止（Wake Lock） ===== */
export async function acquireWake(){
  if(!ST.keepAwake || ST.wakeLock) return;
  try{
    if(navigator.wakeLock && navigator.wakeLock.request){
      ST.wakeLock=await navigator.wakeLock.request('screen');
      ST.wakeLock.addEventListener('release', ()=>{ ST.wakeLock=null; });
    }
  }catch(e){ ST.wakeLock=null; }
}
export function releaseWake(){
  try{ if(ST.wakeLock) ST.wakeLock.release(); }catch(e){}
  ST.wakeLock=null;
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible' && ST.playing) acquireWake();
});

export function startPlay(fromBeat, noCount){
  if(!ST.events.length) return;
  const wasPlaying=ST.playing;
  stopPlay();

  const ctx=audio();
  ST.ctx=ctx; ST.noise=NOISEBUF;
  ST.buses=makeBuses(ctx);
  ST.master=ST.buses.master;
  ST.playing=true;

  ST.range=playRange();
  ST.beatSec=60/ST.tempo;
  ST.passDur=(ST.range.eB - ST.range.sB) * ST.beatSec;

  let from=(typeof fromBeat==='number') ? fromBeat : ST.playhead;
  from=Math.max(ST.range.sB, Math.min(from, ST.range.eB - 0.001));

  const lead = wasPlaying ? 0.10 : 0.16;
  const doCount = ST.countIn && !noCount && !wasPlaying;
  const countBeats = doCount ? 4 : 0;
  ST.t0 = ctx.currentTime + lead + countBeats*ST.beatSec - (from - ST.range.sB)*ST.beatSec;

  if(!ST.range.list.length && !ST.enjoy){
    toast('その小節範囲に音符がありません');
    stopPlay(); return;
  }

  /* 冒頭4カウント（画面全体に数字＋クリック） */
  if(doCount){
    for(let i=0;i<4;i++){
      const at=ctx.currentTime + lead + i*ST.beatSec;
      metroClick(ctx, ST.buses.metro, at, i===0);
      ST.timers.push(setTimeout(()=> showCount(i+1), Math.max(0,(at-ctx.currentTime)*1000)));
    }
    ST.timers.push(setTimeout(hideCount, Math.max(0,(lead + 4*ST.beatSec - 0.05)*1000)));
  } else {
    hideCount();
  }
  acquireWake();

  ST.queue=[]; ST.queuedPass=-1; ST.queueFrom=from;
  pumpQueue();
  ST.schedTimer=setInterval(pumpQueue, SCHED_TICK);
  transportTick();
  updateChrome();
}

/* 予約キューを作る（軽量な記述子のみ。音源はまだ作らない） */
export function fillQueue(untilTime){
  const r=ST.range, bs=ST.beatSec;
  const beats=ST.beatsPerMeasure || 4;
  const barSec=beats*bs;
  const prog=progressionFor(ST.keyRoot, ST.scaleType);
  const loop=loopActive();
  let guard=0;

  while(guard++ < 64){
    const k=ST.queuedPass+1;
    const base=ST.t0 + k*ST.passDur;
    if(k>0 && !loop) break;                 /* ループしないなら1周のみ */
    if(k>0 && base > untilTime) break;      /* 十分先まで作った */
    ST.queuedPass=k;

    const from=(k===0) ? ST.queueFrom : r.sB;
    r.list.forEach(ev=>{
      if(ev.onset < from - 1e-6) return;
      ST.queue.push({t: base + (ev.onset - r.sB)*bs, kind:'note', ev, dur: ev.dur*bs});
    });
    const bars=Math.max(1, Math.round(ST.passDur/barSec));
    for(let b=0;b<bars;b++){
      const tBar=base + b*barSec;
      if(tBar < base + (from - r.sB)*bs - 1e-6) continue;
      ST.queue.push({t:tBar, kind:'bar', bar:b, prog, beats});
    }
    if(!loop){ ST.queue.push({t: base + ST.passDur + 0.35, kind:'end'}); break; }
  }
  ST.queue.sort((a,b)=> a.t - b.t);
}

/* 直前 LOOKAHEAD 秒ぶんだけ実際に音源を作る（＝ループ境界の一括生成を回避） */
export function pumpQueue(){
  if(!ST.playing || !ST.ctx) return;
  const ctx=ST.ctx, B=ST.buses, bs=ST.beatSec;
  const horizon=ctx.currentTime + LOOKAHEAD;
  fillQueue(horizon + ST.passDur*0.6);

  while(ST.queue.length && ST.queue[0].t <= horizon){
    const it=ST.queue.shift();
    if(it.t < ctx.currentTime - 0.06) continue;
    if(it.kind==='note'){
      it.ev.pitches.forEach(p=> playNote(ctx, B.lead, p.midi, it.t, it.dur));
    } else if(it.kind==='bar'){
      if(ST.enjoy) scheduleBar(ctx, B, it.t, bs, it.prog[it.bar%4], it.prog[(it.bar+1)%4], it.beats);
      /* メトロノーム：伴奏OFF時は常に。スケール練習は伴奏ONでも鳴らす（練習の基準） */
      if(!ST.enjoy || ST.mode==='scale') scheduleMetro(ctx, B.metro, it.t, bs, it.beats);
    } else if(it.kind==='end'){
      ST.timers.push(setTimeout(stopPlay, Math.max(0,(it.t - ctx.currentTime)*1000)));
    }
  }
  if(ST.queue.length > 6000) ST.queue.length = 3000;
}

export function currentBeat(){
  if(!ST.playing || !ST.ctx || !ST.range) return ST.playhead || 0;
  const r=ST.range, passBeats=r.eB-r.sB;
  let beat=r.sB + (ST.ctx.currentTime - ST.t0)/ST.beatSec;
  if(loopActive() && passBeats>0){
    const rel=((beat-r.sB)%passBeats+passBeats)%passBeats;
    beat=r.sB+rel;
  }
  return Math.max(r.sB, Math.min(r.eB-0.001, beat));
}
export let tempoTimer=0;
export function setTempo(v, live){
  v=Math.max(30,Math.min(160,v|0));
  ST.tempo=v;
  document.getElementById('tempo').value=v;
  document.getElementById('tempoval').textContent=v+' bpm';
  if(live && ST.playing){
    /* 再生中：現在位置を保って組み直す（リアルタイム反映） */
    const at=currentBeat();
    clearTimeout(tempoTimer);
    tempoTimer=setTimeout(()=>{ if(ST.playing) startPlay(at, true); }, 90);
  }
}
