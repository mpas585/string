/*
  tuner.js — チューナー（マイク→ピッチ検出→指板/メーター表示）。
  元 cello-finger.html L3230–3399 より無改変で移植。
    TUN / detectPitch（自己相関）      … L3230–3262
    startTuner / stopTuner             … L3263–3306
    paintTunerDots（検出音を指板に描く）… L3308–3330
    tunerLoop / updateTunerUI          … L3331–3399
    inputPct / updateInputLevel        … 新規（インプットボリュームゲージ）
  依存: state(ST), util(OPEN/STRNAME/midiName/fingerHint),
        fingerboard(FB/yOf/optionsFor/pluckString), dom(toast),
        modes(render/micUnavailableReason/setTunerHint/syncSheet/syncMicUI)。
  ※ modes は Batch5 後半で作成。それまで実行時は未解決（構文・元一致は検証済み）。
*/
import { ST } from './state.js';
import { OPEN, STRNAME, midiName, fingerHint, strFingerText, tt } from './util.js';
import { FB, yOf, optionsFor, pluckString } from './fingerboard.js';
import { chimeOK, midiFreq } from './audio/synth.js';
import { toast } from './dom.js';
import { render, micUnavailableReason, setTunerHint, syncSheet, syncMicUI } from './modes.js';

export const TUN={on:false, ctx:null, stream:null, analyser:null, buf:null, raf:0, last:0, hist:[],
                  out:null, wasOK:false, lastChime:0};
/* 合図の音を出す。マイク用 AudioContext をそのまま使う（出力先は付いていないので繋ぐ） */
export function tunerBus(){
  if(!TUN.ctx) return null;
  if(!TUN.out){
    TUN.out=TUN.ctx.createGain(); TUN.out.gain.value=1;
    TUN.out.connect(TUN.ctx.destination);
  }
  return TUN.out;
}
/* ===== 基準音（参考の音程を鳴らす） =====
   マイク用の TUN.ctx とは別の AudioContext を使う。
   マイクを許可していなくても基準音だけは鳴らせるようにするため。 */
let refCtx=null, refOut=null, refVoice=null;
function ensureRefCtx(){
  if(!refCtx){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return null;
    refCtx=new AC();
    refOut=refCtx.createGain(); refOut.gain.value=1; refOut.connect(refCtx.destination);
  }
  if(refCtx.state==='suspended'){ try{ refCtx.resume(); }catch(e){} }
  return refCtx;
}
/* 基準となる開放弦。未選択なら一番細い弦（チェロならA線）を既定にする */
export function refMidi(){
  const i=(ST.tunerString!=null && OPEN[ST.tunerString]!=null) ? ST.tunerString : OPEN.length-1;
  return OPEN[i];
}
/* 実際に鳴らす高さ。開放弦そのままだと低すぎて端末のスピーカーで聞こえないので
   1オクターブ上げる（チェロのC線 65Hz → 131Hz、A線 220Hz → 440Hz）。
   オクターブ違いでも合わせる基準としては同じなので、唸りの聞き取りに支障はない。 */
export const REF_OCT = 12;
export function refSoundMidi(){ return refMidi() + REF_OCT; }
export function stopReference(){
  if(!refVoice) return;
  const v=refVoice; refVoice=null;
  try{
    const t=v.ctx.currentTime;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setValueAtTime(v.g.gain.value, t);
    v.g.gain.linearRampToValueAtTime(0.0001, t+0.10);   /* ぶつ切りにしない */
    v.o1.stop(t+0.16); v.o2.stop(t+0.16);
  }catch(e){}
  syncReferenceUI();
}
export function playReference(){
  const ctx=ensureRefCtx();
  if(!ctx) return;
  stopReference();
  const t=ctx.currentTime, f=midiFreq(refSoundMidi());
  /* 純正弦波だと唸り（beat）が聞き取りにくいので、オクターブ上を少しだけ足す */
  const o1=ctx.createOscillator(); o1.type='sine';     o1.frequency.setValueAtTime(f,   t);
  const o2=ctx.createOscillator(); o2.type='triangle'; o2.frequency.setValueAtTime(f*2, t);
  const g2=ctx.createGain(); g2.gain.value=0.10;
  const g=ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.15, t+0.06);
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(refOut);
  o1.start(t); o2.start(t);
  refVoice={ctx,o1,o2,g};
  syncReferenceUI();
}
export function toggleReference(){ refVoice ? stopReference() : playReference(); }
/* 鳴らしたまま弦を選び直したら、止めずにその場で高さを変える */
function retuneReference(){
  if(!refVoice) return;
  const t=refVoice.ctx.currentTime, f=midiFreq(refSoundMidi());
  refVoice.o1.frequency.setTargetAtTime(f,   t, 0.02);
  refVoice.o2.frequency.setTargetAtTime(f*2, t, 0.02);
}
export function syncReferenceUI(){
  const b=document.getElementById('tunRef');
  const n=document.getElementById('tunRefNote');
  if(n) n.textContent=midiName(refSoundMidi());   /* 実際に鳴る高さを出す */
  if(b) b.classList.toggle('on', !!refVoice);
}

export function detectPitch(buf, sr){
  let rms=0;
  for(let i=0;i<buf.length;i++) rms += buf[i]*buf[i];
  rms=Math.sqrt(rms/buf.length);
  if(rms < 0.006) return -1;

  const minLag=Math.max(2, Math.floor(sr/1200));
  const maxLag=Math.min(Math.floor(sr/55), buf.length-2);
  if(maxLag<=minLag) return -1;

  const c=new Float32Array(maxLag+2);
  for(let lag=minLag; lag<=maxLag; lag++){
    let s=0;
    const n=buf.length-lag;
    for(let i=0;i<n;i++) s += buf[i]*buf[i+lag];
    c[lag]=s;
  }
  let lag=minLag;
  while(lag<maxLag && c[lag] > c[lag+1]) lag++;
  let best=-1, bestVal=0;
  for(let i=lag;i<=maxLag;i++){ if(c[i]>bestVal){ bestVal=c[i]; best=i; } }
  if(best<=0) return -1;

  if(best>minLag && best<maxLag){
    const x1=c[best-1], x2=c[best], x3=c[best+1];
    const a=(x1+x3-2*x2)/2, b=(x3-x1)/2;
    if(a) best = best - b/(2*a);
  }
  const f=sr/best;
  if(f<55 || f>1200) return -1;
  return f;
}
export async function startTuner(){
  if(TUN.on) return;
  const reason=micUnavailableReason();
  if(reason){
    setTunerHint(reason);
    syncSheet(); syncMicUI();
    toast(tt('msg.mic_unavailable'));
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}
    });
    const AC=window.AudioContext||window.webkitAudioContext;
    const ctx=new AC();
    if(ctx.state==='suspended'){ try{ await ctx.resume(); }catch(e){} }
    const src=ctx.createMediaStreamSource(stream);
    const an=ctx.createAnalyser(); an.fftSize=2048;
    src.connect(an);
    TUN.on=true; TUN.ctx=ctx; TUN.stream=stream; TUN.analyser=an;
    TUN.buf=new Float32Array(an.fftSize);
    TUN.hist=[]; TUN.last=0;
    TUN.out=null; TUN.wasOK=false; TUN.lastChime=0;
    setTunerHint(null);
    syncMicUI(); syncSheet();
    if(ST.mode==='tuner') render();
    tunerLoop();
  }catch(e){
    setTunerHint(tt('msg.mic_start_fail_html') + e.message
      + tt('msg.mic_check_perm_html'));
    syncSheet(); syncMicUI();
    toast(tt('msg.mic_start_fail', e.message));
  }
}
export function stopTuner(){
  TUN.on=false;
  if(TUN.raf) cancelAnimationFrame(TUN.raf);
  TUN.raf=0;
  if(TUN.stream){ TUN.stream.getTracks().forEach(t=>{ try{t.stop();}catch(e){} }); }
  if(TUN.ctx){ try{ TUN.ctx.close(); }catch(e){} }
  TUN.ctx=null; TUN.stream=null; TUN.analyser=null; TUN.buf=null;
  TUN.out=null; TUN.wasOK=false; TUN.lastChime=0;
  stopReference();                            /* シートを閉じたら基準音も止める */
  ST.tunerMidi=null; ST.tunerCents=0;
  ST.tunerString=null; syncTunerString();     /* 次に開いた時は自動判定から始める */
  updateInputLevel(0, 0);
  setTunerDir(null);
  syncMicUI(); syncSheet();
  if(ST.mode==='tuner'){ paintTunerDots(null, 0); render(); }
}
/* チューナーモード：検出音を指板に描く */
export function paintTunerDots(midi, cents){
  const col = (midi==null) ? 'var(--muted)'
            : (Math.abs(cents)<=6  ? 'var(--good)'
            : (Math.abs(cents)<=25 ? 'var(--accent)' : 'var(--danger)'));
  for(let i=0;i<4;i++){
    const dot=document.getElementById('tdot'+i);
    const lbl=document.getElementById('tlbl'+i);
    if(!dot || !lbl) continue;
    const off = (midi==null) ? -1 : (midi - OPEN[i]);
    if(midi==null || off<0 || off>FB.maxOff){
      dot.setAttribute('opacity','0');
      lbl.setAttribute('opacity','0');
      continue;
    }
    const y=yOf(off);
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('fill', col);
    dot.setAttribute('opacity','0.95');
    lbl.setAttribute('y', (y+5).toFixed(1));
    lbl.textContent=fingerHint(off);
    lbl.setAttribute('opacity','1');
  }
}
/* ===== 締める／緩める の案内 =====
   state: null（検出なし）／'low'（音が低い＝弦を締める）／'high'（音が高い＝緩める）／'ok'
   文言は HTML 側に3つとも書いてあり、CSS でどれを見せるかを切り替える（JS に文言を持たない）。 */
export function setTunerDir(state){
  const el=document.getElementById('tunDir');
  if(!el) return;
  el.className='tun-dir' + (state ? ' '+state : '');
}
/* ===== インプットボリュームゲージ =====
   RMS を dB に直して -60dB〜0dB をバー全幅に割り当てる。
   推奨インプットレベルは -30dB〜-9dB。バーは全幅のグラデーションを clip-path で
   左から見せる方式なので、同じ色＝常に同じレベルを指す（CSS の目盛りと位置が一致する）。 */
export const IN_MIN_DB=-60, IN_REC_LO=-30, IN_REC_HI=-9;
export function inputPct(db){
  return Math.max(0, Math.min(100, (db - IN_MIN_DB) / (0 - IN_MIN_DB) * 100));
}
export function updateInputLevel(rms, peak){
  const bar=document.getElementById('tunLevel');
  const msg=document.getElementById('tunInMsg');
  if(!bar || !msg) return;
  if(!TUN.on){
    bar.style.clipPath='inset(0 100% 0 0)';
    msg.textContent='–'; msg.className='';
    return;
  }
  const db=20*Math.log10(Math.max(rms, 1e-6));
  const hot=(peak>=0.98) || (db>IN_REC_HI);
  const ok =!hot && (db>=IN_REC_LO);
  bar.style.clipPath='inset(0 '+(100-inputPct(db)).toFixed(1)+'% 0 0)';
  msg.textContent = hot ? tt('msg.lvl_too_loud')
                  : ok  ? 'OK'
                  : (db < IN_MIN_DB+8) ? tt('msg.lvl_too_quiet') : tt('msg.lvl_louder');
  msg.className = hot ? 'hot' : (ok ? 'ok' : 'low');
}
export function tunerLoop(){
  if(!TUN.on) return;
  TUN.raf=requestAnimationFrame(tunerLoop);
  const now=performance.now();
  if(now - TUN.last < 50) return;     /* 約20fpsに制限 */
  TUN.last=now;
  TUN.analyser.getFloatTimeDomainData(TUN.buf);
  let sq=0, pk=0;
  for(let i=0;i<TUN.buf.length;i++){
    const v=TUN.buf[i];
    sq+=v*v;
    const a=(v<0)?-v:v;
    if(a>pk) pk=a;
  }
  updateInputLevel(Math.sqrt(sq/TUN.buf.length), pk);
  const f=detectPitch(TUN.buf, TUN.ctx.sampleRate);
  updateTunerUI(f);
}
export function updateTunerUI(f){
  const nEl=document.getElementById('tunNote');
  const cEl=document.getElementById('tunCent');
  const hEl=document.getElementById('tunHz');
  const ndl=document.getElementById('tunNeedle');
  const trl=document.getElementById('tunTrail');     /* 残像。針より遅く追従する */
  const strs=document.querySelectorAll('.tun-str [data-str]');

  if(f<=0){
    nEl.textContent='–'; nEl.classList.remove('ok');
    cEl.textContent='– cent'; hEl.textContent='– Hz';
    ndl.style.left='50%'; ndl.classList.remove('ok');
    if(trl){ trl.style.left='50%'; trl.classList.remove('ok'); }
    strs.forEach(s=>s.classList.remove('hit'));
    TUN.hist=[];
    setTunerDir(null);
    TUN.wasOK=false;
    if(ST.mode==='tuner' && ST.tunerMidi!=null){
      ST.tunerMidi=null; ST.tunerCents=0;
      paintTunerDots(null, 0);
      document.getElementById('nowline').textContent=tt('msg.tuner_on_hint');
    }
    return;
  }
  TUN.hist.push(f);
  if(TUN.hist.length>5) TUN.hist.shift();
  const sorted=[...TUN.hist].sort((a,b)=>a-b);
  const fm=sorted[Math.floor(sorted.length/2)];

  const midiF=69 + 12*Math.log2(fm/440);
  const det=Math.round(midiF);                 /* 実際に聞こえている音（指板・下部表示はこれ） */
  /* 弦を選んでいればその開放弦が基準。選んでいなければ従来どおり一番近い音が基準。 */
  const lock=(ST.tunerString!=null && OPEN[ST.tunerString]!=null) ? ST.tunerString : null;
  const ref=(lock!=null) ? OPEN[lock] : det;
  const cents=Math.round((midiF-ref)*100);
  /* 半音以上ずれている＝別の弦かオクターブ違いを拾っている疑い。
     ここで「締める」を出すと、その通りに巻いて弦を切ることがあるので出さない。 */
  const far=(lock!=null) && Math.abs(cents)>100;
  const inTune=!far && Math.abs(cents)<=6;

  nEl.textContent=midiName(far ? det : ref);
  nEl.classList.toggle('ok', inTune);
  cEl.textContent=(cents>0?'+':'')+cents+' cent';
  hEl.textContent=fm.toFixed(1)+' Hz';
  const pos=Math.max(0, Math.min(100, 50 + (cents/50)*50));
  ndl.style.left=pos+'%';
  ndl.classList.toggle('ok', inTune);
  if(trl){ trl.style.left=pos+'%'; trl.classList.toggle('ok', inTune); }

  /* 締める／緩める。低い＝張りが足りない＝締める、高い＝緩める */
  setTunerDir(far ? 'far' : (inTune ? 'ok' : (cents<0 ? 'low' : 'high')));

  /* 合ったら1回だけ「ピコーン」。読みが落ち着いてから鳴らし、連打はしない */
  const nowMs=performance.now();
  if(inTune && !TUN.wasOK && TUN.hist.length>=3 && nowMs-TUN.lastChime>1200){
    const bus=tunerBus();
    if(bus){ try{ chimeOK(TUN.ctx, bus, TUN.ctx.currentTime+0.01); }catch(e){} }
    TUN.lastChime=nowMs;
  }
  TUN.wasOK=inTune;

  /* 弦チップ：.on＝選択中（手動）、.hit＝いま鳴っている音に近い開放弦 */
  let bi=0, bd=1e9;
  OPEN.forEach((m,i)=>{ const d=Math.abs(midiF-m); if(d<bd){ bd=d; bi=i; } });
  strs.forEach((s,i)=>{
    s.classList.toggle('on', lock===i);
    s.classList.toggle('hit', lock===null && i===bi && bd<1.5);
  });

  /* チューナーモード：指板に検出音の位置を描く */
  if(ST.mode==='tuner'){
    if(ST.tunerMidi!==det){
      const o=optionsFor(det);
      if(o.length) pluckString(o[0].str, o[0].off, 0.8);
    }
    ST.tunerMidi=det; ST.tunerCents=Math.round((midiF-det)*100);
    paintTunerDots(det, ST.tunerCents);
    const opts=optionsFor(det);
    const where = opts.length
      ? opts.map(o=> strFingerText(o.str, o.off, o.finger)).join(' / ')
      : tt('msg.out_of_range');
    document.getElementById('nowline').innerHTML =
      `<b>${midiName(det)}</b> ${(ST.tunerCents>0?'+':'')+ST.tunerCents}¢ · ${where}`;
  }
}

/* 弦チップのタップ：選択／解除（もう一度押すと自動判定に戻る） */
export function pickTunerString(i){
  ST.tunerString = (ST.tunerString===i) ? null : i;
  syncTunerString();
  retuneReference(); syncReferenceUI();   /* 基準音も選んだ弦に合わせる */
  TUN.wasOK=false;                    /* 基準が変わるので「合った」判定はやり直し */
}
export function syncTunerString(){
  document.querySelectorAll('.tun-str [data-str]').forEach((s,i)=>{
    s.classList.toggle('on', ST.tunerString===i);
    if(ST.tunerString!=null) s.classList.remove('hit');
  });
}
