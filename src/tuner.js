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
import { OPEN, STRNAME, midiName, fingerHint, tt } from './util.js';
import { FB, yOf, optionsFor, pluckString } from './fingerboard.js';
import { toast } from './dom.js';
import { render, micUnavailableReason, setTunerHint, syncSheet, syncMicUI } from './modes.js';

export const TUN={on:false, ctx:null, stream:null, analyser:null, buf:null, raf:0, last:0, hist:[]};
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
  ST.tunerMidi=null; ST.tunerCents=0;
  updateInputLevel(0, 0);
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
/* ===== インプットボリュームゲージ =====
   RMS を dB に直して -60dB〜0dB をバー全幅に割り当てる。
   推奨インプットレベルは -30dB〜-9dB（CSS の .tun-in-bar .rec ＝ left:50% / width:35% と一致）。 */
export const IN_MIN_DB=-60, IN_REC_LO=-30, IN_REC_HI=-9;
export function inputPct(db){
  return Math.max(0, Math.min(100, (db - IN_MIN_DB) / (0 - IN_MIN_DB) * 100));
}
export function updateInputLevel(rms, peak){
  const bar=document.getElementById('tunLevel');
  const msg=document.getElementById('tunInMsg');
  if(!bar || !msg) return;
  if(!TUN.on){
    bar.style.width='0%'; bar.className='lv';
    msg.textContent='–'; msg.className='';
    return;
  }
  const db=20*Math.log10(Math.max(rms, 1e-6));
  const hot=(peak>=0.98) || (db>IN_REC_HI);
  const ok =!hot && (db>=IN_REC_LO);
  bar.style.width=inputPct(db).toFixed(1)+'%';
  bar.className='lv' + (hot ? ' hot' : (ok ? ' ok' : ''));
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
  const strs=document.querySelectorAll('.tun-str span');

  if(f<=0){
    nEl.textContent='–'; nEl.classList.remove('ok');
    cEl.textContent='– cent'; hEl.textContent='– Hz';
    ndl.style.left='50%'; ndl.classList.remove('ok');
    strs.forEach(s=>s.classList.remove('on'));
    TUN.hist=[];
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
  const near=Math.round(midiF);
  const cents=Math.round((midiF-near)*100);
  const inTune=Math.abs(cents)<=6;

  nEl.textContent=midiName(near);
  nEl.classList.toggle('ok', inTune);
  cEl.textContent=(cents>0?'+':'')+cents+' cent';
  hEl.textContent=fm.toFixed(1)+' Hz';
  const pos=Math.max(0, Math.min(100, 50 + (cents/50)*50));
  ndl.style.left=pos+'%';
  ndl.classList.toggle('ok', inTune);

  /* 開放弦の近さ */
  let bi=0, bd=1e9;
  OPEN.forEach((m,i)=>{ const d=Math.abs(midiF-m); if(d<bd){ bd=d; bi=i; } });
  strs.forEach((s,i)=> s.classList.toggle('on', i===bi && bd<1.5));

  /* チューナーモード：指板に検出音の位置を描く */
  if(ST.mode==='tuner'){
    if(ST.tunerMidi!==near){
      const o=optionsFor(near);
      if(o.length) pluckString(o[0].str, o[0].off, 0.8);
    }
    ST.tunerMidi=near; ST.tunerCents=cents;
    paintTunerDots(near, cents);
    const opts=optionsFor(near);
    const where = opts.length
      ? opts.map(o=> tt('msg.str_finger', STRNAME[o.str], o.finger)).join(' / ')
      : tt('msg.out_of_range');
    document.getElementById('nowline').innerHTML =
      `<b>${midiName(near)}</b> ${(cents>0?'+':'')+cents}¢ · ${where}`;
  }
}
