/*
  audio/synth.js — 発音（チェロ・ドラム・ベース・コード・メトロノーム）。
  元 cello-finger.html より無改変で移植。
    midiFreq  … L2248
    playNote  … L2249–2304   （チェロ／ガイドメロ）
    drKick/drSnare/drHat … L2327–2358
    bassNote  … L2359–2378
    padChord  … L2380–2430   （コード＝ピアノ）
    metroClick… L2433–2444
  依存は state（ST.noise）のみ。ctx/bus は呼び出し側から受け取る（DOM非依存）。
*/

import { ST } from '../state.js';

export function midiFreq(m){ return 440*Math.pow(2,(m-69)/12); }

export function playNote(ctx, bus, midi, t, dur){
  const f=midiFreq(midi);
  const end=t+Math.max(dur,0.18);
  const rel=0.14, atk=0.055;                       /* 弓のアタック */

  /* 弓圧でローパスが開く（胴鳴りはバス側にあるので1音ごとには作らない） */
  const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=0.7;
  lp.frequency.setValueAtTime(Math.min(700, f*3), t);
  lp.frequency.linearRampToValueAtTime(Math.min(5200, f*9), t+0.10);
  lp.frequency.linearRampToValueAtTime(Math.min(3400, f*6.5), end);

  /* ビブラート（少し遅れてかかる） */
  const lfo=ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=4.9 + Math.random()*0.7;
  const vib=ctx.createGain();
  vib.gain.setValueAtTime(0, t);
  vib.gain.linearRampToValueAtTime(f*0.007, t+0.35);   /* ≒12セント */

  const g=ctx.createGain();
  const peak=0.16;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t+atk);
  g.gain.setValueAtTime(peak, Math.max(t+atk, end-rel));
  g.gain.linearRampToValueAtTime(0.0001, end);

  /* ユニゾン（デチューンした鋸波3本＋サブ） */
  const nodes=[lfo];
  [[-8, 0.42],[0, 0.55],[8, 0.42]].forEach(([det, amt])=>{
    const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; o.detune.value=det;
    const og=ctx.createGain(); og.gain.value=amt;
    vib.connect(o.frequency);
    o.connect(og); og.connect(lp);
    nodes.push(o);
  });
  const sub=ctx.createOscillator(); sub.type='sine'; sub.frequency.value=f/2;
  const sg=ctx.createGain(); sg.gain.value=0.16;
  sub.connect(sg); sg.connect(lp); nodes.push(sub);

  /* 弓のノイズ（アタックだけ） */
  if(ST.noise){
    const n=ctx.createBufferSource(); n.buffer=ST.noise;
    const nf=ctx.createBiquadFilter(); nf.type='bandpass';
    nf.frequency.value=Math.min(3200, f*4.5); nf.Q.value=0.9;
    const ng=ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.055, t+0.018);
    ng.gain.exponentialRampToValueAtTime(0.0001, t+0.14);
    n.connect(nf); nf.connect(ng); ng.connect(g);
    n.start(t); n.stop(t+0.2);
  }

  lfo.connect(vib);
  lp.connect(g); g.connect(bus);
  nodes.forEach(o=>{ o.start(t); o.stop(end+0.06); });
  /* 終了時にグラフから切り離す（ノードが溜まって重くなるのを防ぐ） */
  nodes[nodes.length-1].onended=()=>{ try{ vib.disconnect(); lp.disconnect(); g.disconnect(); }catch(e){} };
}

export function drKick(ctx, bus, t){
  const o=ctx.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(140,t);
  o.frequency.exponentialRampToValueAtTime(45,t+0.12);
  const g=ctx.createGain();
  g.gain.setValueAtTime(0.0001,t);
  g.gain.linearRampToValueAtTime(0.9,t+0.006);
  g.gain.exponentialRampToValueAtTime(0.0001,t+0.24);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t+0.28);
}
export function drSnare(ctx, bus, t){
  const s=ctx.createBufferSource(); s.buffer=ST.noise;
  const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1900; bp.Q.value=0.8;
  const g=ctx.createGain();
  g.gain.setValueAtTime(0.0001,t);
  g.gain.linearRampToValueAtTime(0.35,t+0.004);
  g.gain.exponentialRampToValueAtTime(0.0001,t+0.15);
  s.connect(bp); bp.connect(g); g.connect(bus);
  s.start(t); s.stop(t+0.18);
}
export function drHat(ctx, bus, t, open){
  const s=ctx.createBufferSource(); s.buffer=ST.noise;
  const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=7500;
  const g=ctx.createGain();
  const d=open?0.12:0.045;
  g.gain.setValueAtTime(0.0001,t);
  g.gain.linearRampToValueAtTime(0.12,t+0.003);
  g.gain.exponentialRampToValueAtTime(0.0001,t+d);
  s.connect(hp); hp.connect(g); g.connect(bus);
  s.start(t); s.stop(t+d+0.03);
}
export function bassNote(ctx, bus, t, dur, midi, vel){
  const f=midiFreq(midi);
  const v=(typeof vel==='number') ? vel : 1;
  const o=ctx.createOscillator(); o.type='triangle'; o.frequency.value=f;
  const o2=ctx.createOscillator(); o2.type='sine'; o2.frequency.value=f/2;
  const lp=ctx.createBiquadFilter(); lp.type='lowpass';
  /* アタックで少し開いてすぐ閉じる＝指弾きのニュアンス */
  lp.frequency.setValueAtTime(Math.min(2200, f*10), t);
  lp.frequency.exponentialRampToValueAtTime(Math.min(700, f*4), t+0.09);
  lp.Q.value=1.1;
  const g=ctx.createGain();
  const end=t+dur;
  const peak=0.30*v;
  g.gain.setValueAtTime(0.0001,t);
  g.gain.linearRampToValueAtTime(peak, t+0.012);
  g.gain.exponentialRampToValueAtTime(peak*0.55, t+Math.min(0.12, dur*0.4));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bus);
  o.start(t); o2.start(t); o.stop(end+0.03); o2.stop(end+0.03);
}
/* コード：ピアノ（打鍵→2段減衰。倍音は高いほど早く減衰） */
export function padChord(ctx, bus, t, dur, midis){
  const end=t+dur;
  midis.forEach((m, idx)=>{
    const f=midiFreq(m);
    const peak=0.115;

    /* 高倍音が先に減衰する＝ローパスを閉じていく */
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=0.5;
    lp.frequency.setValueAtTime(Math.min(6500, f*14), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(2200, f*5), t+0.30);
    lp.frequency.exponentialRampToValueAtTime(Math.min(900,  f*2.6), t+Math.min(dur, 2.2));

    /* 打弦の2段減衰（速い初期減衰＋長いテール） */
    const g=ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t+0.006);
    g.gain.exponentialRampToValueAtTime(peak*0.38, t+0.28);
    g.gain.exponentialRampToValueAtTime(peak*0.13, t+Math.min(dur*0.75, 1.8));
    g.gain.exponentialRampToValueAtTime(0.0001, end);

    /* 同音の弦を2本（わずかにデチューン）＋倍音 */
    const nodes=[];
    [[-4, 0.50],[4, 0.50]].forEach(([det, amt])=>{
      const o=ctx.createOscillator(); o.type='triangle'; o.frequency.value=f; o.detune.value=det;
      const og=ctx.createGain(); og.gain.value=amt;
      o.connect(og); og.connect(lp); nodes.push(o);
    });
    const saw=ctx.createOscillator(); saw.type='sawtooth'; saw.frequency.value=f;
    const sawG=ctx.createGain(); sawG.gain.value=0.22;
    saw.connect(sawG); sawG.connect(lp); nodes.push(saw);
    const h2=ctx.createOscillator(); h2.type='sine'; h2.frequency.value=f*2.01;   /* 軽い不協和＝ピアノらしさ */
    const h2G=ctx.createGain(); h2G.gain.value=0.14;
    h2.connect(h2G); h2G.connect(lp); nodes.push(h2);

    /* ハンマーの打撃音（最低音だけ） */
    if(idx===0 && ST.noise){
      const n=ctx.createBufferSource(); n.buffer=ST.noise;
      const nf=ctx.createBiquadFilter(); nf.type='bandpass';
      nf.frequency.value=Math.min(2600, f*5); nf.Q.value=0.8;
      const ng=ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.045, t+0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, t+0.07);
      n.connect(nf); nf.connect(ng); ng.connect(g);
      n.start(t); n.stop(t+0.12);
    }

    lp.connect(g); g.connect(bus);
    nodes.forEach(o=>{ o.start(t); o.stop(end+0.05); });
  });
}

/* チューナー：ピッチが合った合図（「ピコーン」＝低→高の2音ベル）。
   ノイズバッファを使わないので、マイク用の別 AudioContext でもそのまま鳴らせる。 */
export function chimeOK(ctx, bus, t){
  [[1318.5, 0, 0.16], [1975.5, 0.075, 0.34]].forEach(([f, dly, dur])=>{
    const at=t+dly;
    const g=ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.20, at+0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at+dur);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
    const h=ctx.createOscillator(); h.type='sine'; h.frequency.value=f*2.76;  /* 金属質の倍音 */
    const hg=ctx.createGain(); hg.gain.value=0.18;
    o.connect(g); h.connect(hg); hg.connect(g); g.connect(bus);
    o.start(at); h.start(at); o.stop(at+dur+0.05); h.stop(at+dur+0.05);
  });
}

/* メトロノーム（エンジョイモードOFF時） */
export function metroClick(ctx, bus, t, accent){
  const o=ctx.createOscillator(); o.type='square';
  o.frequency.value = accent ? 1600 : 1000;
  const bp=ctx.createBiquadFilter(); bp.type='bandpass';
  bp.frequency.value = accent ? 1600 : 1000; bp.Q.value=2;
  const g=ctx.createGain();
  const peak = accent ? 0.26 : 0.13;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t+0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.045);
  o.connect(bp); bp.connect(g); g.connect(bus);
  o.start(t); o.stop(t+0.06);
}
