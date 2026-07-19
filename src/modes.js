/*
  modes.js — 全体統括（render）・モード制御・UI同期・オクターブ・運指編集。
  元 cello-finger.html より無改変で移植。
    render                                   … L1338–1384
    renderLegend/applyMode/setMode/レイアウト同期(mq等)/renderNow/renderEdit … L1515–1662
    stripSignature/updateStripActive/renderStrip/scrollStripToActive（運指ストリップ） … L1690–1732
    selectEvent/setLead/setStringForSelected/setFinger/setPref（音符選択・運指編集） … L1827–1867
    playableCount/autoShift/shiftOK/applyOctave/setOctave/setScore（オクターブ・譜面セット） … L2750–2829
    genScale（スケール生成統括）                … L3067–3084
    syncLoopUI/setLoopRange（ループUI）          … L3402–3427
    setZoom                                    … L3448–3454
    updateChrome（FAB/gear/保存表示）            … L3481–3490
  drawer（saveSettings/loadFingering/syncSettingsUI/closeDrawer 等）・songs（renderTracks/loadSample）は
  次バッチで作成。それまで実行時は未解決（構文・元一致は検証済み）。
*/
import { ST, volProfileKey } from './state.js';
import { fracOf, midiName, zoneOf, fingerHint, NOTE_NAMES, OPEN, STRNAME } from './util.js';
import { applyZoom, optionsFor, recommend, renderBoard, scrollBoardToActive, zoomFitPositions } from './fingerboard.js';
import { renderStaff } from './notation.js';
import { buildScaleEvents, SCALE_LABEL } from './scale.js';
import { currentBeat, startPlay, stopPlay, updateTransport } from './audio/scheduler.js';
import { paintTunerDots, startTuner, stopTuner, TUN } from './tuner.js';
import { warmAudio } from './audio/context.js';
import { toast } from './dom.js';
import { closeDrawer, saveSettings, saveFingering, loadFingering, syncSettingsUI, Store } from './drawer.js';
import { loadSample, renderTracks, midiFile, setMidiFile } from './songs.js';

export function render(){
  const picker  = document.getElementById('picker');
  const emptyEl = document.getElementById('empty');

  /* モード未選択 → 入口画面 */
  if(!ST.mode){
    picker.style.display='flex';
    emptyEl.style.display='none';
    renderBoard(null);
    document.getElementById('nowline').textContent='モードを選んでください';
    renderLegend(); updateTransport(); updateChrome();
    return;
  }
  picker.style.display='none';

  /* チューナーモード → 譜面なしで指板＋検出表示 */
  if(ST.mode==='tuner'){
    emptyEl.style.display='none';
    renderBoard(null);
    document.getElementById('nowline').textContent = TUN.on ? '弾いた音が指板に出ます' : 'マイクをONにしてください';
    paintTunerDots(ST.tunerMidi, ST.tunerCents);
    renderLegend(); updateTransport(); updateChrome();
    return;
  }

  if(!ST.events.length){
    emptyEl.style.display='flex';
    emptyEl.innerHTML = (ST.mode==='score')
      ? '<b>譜面を読み込んでください</b><div><span class="kbd">☰</span> から MusicXML / MIDI を開く</div>'
      : '<b>スケールを生成してください</b><div><span class="kbd">☰</span> からキーとスケールを選ぶ</div>';
    renderBoard(null);
    document.getElementById('nowline').textContent = (ST.mode==='score') ? '譜面を開いてください' : 'スケールを生成してください';
    document.getElementById('edit').innerHTML='<div class="empty-edit">音符を選ぶと運指を編集できます</div>';
    renderLegend(); updateTransport(); updateChrome();
    return;
  }
  emptyEl.style.display='none';
  const focusId = ST.current!=null ? ST.current : (ST.selected!=null ? ST.selected : 0);
  const ev = ST.events[focusId] || null;
  renderBoard(ev);
  if(ST.view==='staff') renderStaff();
  renderNow(ev);
  renderEdit(ev);
  renderLegend();
  updateTransport();
  updateChrome();
}
export function renderLegend(){
  const lg=document.getElementById('legend');
  if(!ST.mode || ST.mode==='tuner' || !ST.events.length){ lg.style.display='none'; return; }
  lg.style.display='flex';
  const chordItem = (ST.mode==='score') ? '<span><i class="dot chord"></i>和音の他音</span>' : '';
  lg.innerHTML = '<span><i class="dot lead"></i>' + (ST.mode==='score' ? 'リード' : '押さえる音') + '</span>'
    + chordItem
    + '<span><i class="dot alt"></i>別弦の候補(タップで変更)</span>';
}

/* ===== 練習モードの切替 ===== */
export function applyMode(){
  document.querySelectorAll('[data-m]').forEach(el=>{
    const modes=el.dataset.m.split(' ');
    el.classList.toggle('m-hide', !ST.mode || !modes.includes(ST.mode));
  });
  document.querySelectorAll('#modeSeg button').forEach(b=>{
    b.classList.toggle('on', b.dataset.mode===ST.mode);
  });
}
export function setMode(mode, keepDrawer){
  if(mode==='game'){ toast('ミニゲームは準備中です'); return; }
  warmAudio();
  if(ST.mode===mode) return;
  stopPlay();

  /* チューナーモードを離れる → マイクとシートを必ず閉じる */
  if(ST.mode==='tuner' && mode!=='tuner') stopTuner();

  ST.mode=mode;
  ST.events=[]; ST.measures=[]; ST.selected=null; ST.current=null;
  ST.lastScrollId=null; ST.scoreName='';
  setMidiFile(null); renderTracks();
  applyMode();
  ST.vol = ST.volProfiles[volProfileKey()];      /* モード別の音量プロファイル */
  syncSettingsUI();
  syncSheet();

  if(mode==='scale'){
    genScale(true);
    if(!keepDrawer) closeDrawer();
    toast('☰ からキー・スケール・伴奏を変えられます');

  } else if(mode==='score'){
    /* 伴奏はキーが前提のためスケール練習モード専用 */
    ST.enjoy=false;
    document.getElementById('enjoySw').classList.remove('on');
    loadSample(true);                       /* プリセット：G線上のアリア */
    if(!keepDrawer) closeDrawer();
    toast('白鳥（☰ から別の譜面も開けます）');

  } else if(mode==='tuner'){
    ST.enjoy=false;
    document.getElementById('enjoySw').classList.remove('on');
    ST.tunerMidi=null; ST.tunerCents=0;
    if(!keepDrawer) closeDrawer();
    render();
    if(!TUN.on) startTuner();
  }
}
/* 横レイアウト（実際に横 or 強制横）をbodyクラスで管理 */
export function mq(q){
  try{ return (window.matchMedia && window.matchMedia(q)) || null; }catch(e){ return null; }
}
export function isLandscapeDevice(){
  const m=mq('(orientation: landscape)');
  if(m) return m.matches;
  return window.innerWidth > window.innerHeight;      /* matchMedia が無い環境の保険 */
}
export function syncLayoutClass(){
  document.body.classList.toggle('landscape-layout', ST.landscape || isLandscapeDevice());
}
window.addEventListener('resize', ()=>{ syncLayoutClass(); applyZoom(); if(ST.view==='staff') renderStaff(); });
(function(){
  const m=mq('(orientation: landscape)');
  if(m && m.addEventListener){
    m.addEventListener('change', ()=>{ syncLayoutClass(); setTimeout(()=>{ applyZoom(); render(); }, 200); });
  }
})();

/* チューナーシートはチューナーモードでのみ表示 */
export function syncSheet(){
  document.getElementById('tunerSheet').classList.toggle('open', ST.mode==='tuner');
}
/* マイクのON/OFF表示 */
export function syncMicUI(){
  document.getElementById('micSw').classList.toggle('on', TUN.on);
}
/* チューナーの状態メッセージ（file:// で無反応にならないように） */
export function setTunerHint(msg){
  const el=document.getElementById('tunHint');
  if(!msg){ el.classList.remove('show'); el.innerHTML=''; return; }
  el.classList.add('show');
  el.innerHTML = msg + '<div><button id="micRetry">マイクを許可する</button></div>';
  const btn=document.getElementById('micRetry');
  if(btn) btn.addEventListener('click', ()=> startTuner());
}
export function micUnavailableReason(){
  const secure = (typeof isSecureContext!=='undefined') ? isSecureContext : (location.protocol==='https:' || location.hostname==='localhost');
  if(!secure || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    return '<b>マイクを使えません。</b>ブラウザの制限で、<b>file://</b> ではマイクを開けません。'
         + '<br>このHTMLを <b>https://</b> か <b>localhost</b> から開いてください。'
         + '<br><span style="color:var(--faint)">例：フォルダで <code>python3 -m http.server</code> → <code>http://localhost:8000/</code></span>';
  }
  return null;
}

export function renderNow(ev){
  const el=document.getElementById('nowline');
  if(!ev || !ev.fing){ el.innerHTML=''; return; }
  const lead=ev.pitches[ev.leadIdx];
  el.innerHTML = `<b>${lead.name}</b> · ${STRNAME[ev.fing.str]}線${ev.fing.finger}指 · ${ev.fing.zone}`;
}

export function renderEdit(ev){
  const el=document.getElementById('edit');
  if(!ev){ el.innerHTML='<div class="empty-edit">音符を選ぶと運指を編集できます</div>'; return; }
  const lead=ev.pitches[ev.leadIdx];

  let cur=`<div class="cur">`;
  ev.pitches.forEach((p,i)=>{
    cur += `<span class="${i===ev.leadIdx?'lead':'oth'}">${p.name}</span>${i<ev.pitches.length-1?' ':''}`;
  });
  cur+=`</div>`;

  /* リード選択（和音のとき） */
  let leadGrp='';
  if(ev.pitches.length>1){
    leadGrp = `<div class="grp"><div class="lbl">リード（旋律）に使う音</div><div class="chips">`
      + ev.pitches.map((p,i)=>`<div class="chip lead-pick ${i===ev.leadIdx?'on':''}" data-idx="${i}">${p.name}</div>`).join('')
      + `</div></div>`;
  }

  /* 弦選択 */
  const opts = optionsFor(lead.midi);
  const strGrp = `<div class="grp"><div class="lbl">弦（押さえる位置）</div><div class="chips">`
    + opts.map(o=>`<div class="chip str-pick ${ev.fing&&ev.fing.str===o.str?'on':''}" data-str="${o.str}">${STRNAME[o.str]}線<small>${o.zone}</small></div>`).join('')
    + `</div></div>`;

  /* 指の目安 */
  const fingerOpts = (ev.fing && ev.fing.off===0) ? ['開'] : ['1','2','3','4','親'];
  const fingGrp = `<div class="grp"><div class="lbl">指（目安・修正可）</div><div class="chips">`
    + fingerOpts.map(fn=>`<div class="chip fing-pick ${ev.fing&&ev.fing.finger===fn?'on':''}" data-fin="${fn}">${fn}</div>`).join('')
    + `</div></div>`;

  el.innerHTML = `<h3>選択中の音符</h3>${cur}${leadGrp}${strGrp}${fingGrp}`
    + `<div class="hint">指板の ○（別弦候補）をタップしても弦を変えられます。ポジション名・指は目安なので、実際の運指に合わせて修正してください。</div>`;
}
export let stripSig='';
export function stripSignature(){
  return [ST.events.length, ST.scoreName, ST.octShift,
          ST.events.map(e=> e.fing ? (e.fing.str+''+e.fing.finger) : '-').join(',')].join('|');
}
export function updateStripActive(){
  const el=document.getElementById('strip');
  if(!el) return;
  el.querySelectorAll('.nchip').forEach(c=>{
    const id=+c.dataset.id;
    c.classList.toggle('on', id===ST.selected);
    c.classList.toggle('playing', id===ST.current);
  });
}
export function renderStrip(){
  const el=document.getElementById('strip');
  const sig=stripSignature();
  if(sig===stripSig && el.querySelector('.nchip')){
    updateStripActive();          /* 再構築しない＝スクロール位置を保つ */
    return;
  }
  stripSig=sig;
  let html='', curM=-1;
  ST.events.forEach(ev=>{
    if(ev.measure!==curM){ curM=ev.measure; html+=`<div class="mbar">${curM}</div>`; }
    const lead=ev.pitches[ev.leadIdx];
    const f=ev.fing;
    const zc = f ? (f.klass==='low'?'zone-low':f.klass==='mid'?'zone-mid':'zone-high') : '';
    const sub = f ? `${STRNAME[f.str]}·${f.finger}` : '音域外';
    const chord = (ev.pitches.length>1) ? '<i class="ch"></i>' : '';
    const cls = (ev.id===ST.selected?' on':'') + (ev.id===ST.current?' playing':'') + (f?'':' out');
    html += `<div class="nchip${cls}" data-id="${ev.id}">${chord}<b>${lead.name}</b><small class="${zc}">${sub}</small></div>`;
  });
  el.innerHTML=html;
}
export function scrollStripToActive(){
  if(Date.now() - (ST.stripHold||0) < 3500) return;   /* スワイプ直後は追従しない */
  const wrap=document.getElementById('strip');
  const el=wrap.querySelector('.nchip.playing') || wrap.querySelector('.nchip.on');
  if(!el || !wrap.clientWidth) return;
  const target = el.offsetLeft - wrap.clientWidth/2 + el.offsetWidth/2;
  wrap.scrollTo({left: Math.max(0, target), behavior:'smooth'});
}
export function selectEvent(id){
  ST.selected = id;
  if(!ST.playing) ST.current = null;
  const ev=ST.events[id];
  if(ev) ST.playhead=ev.onset;         /* ★ 選んだ音から再生できるように */
  render();
}
export function setLead(idx){
  if(ST.selected==null) return;
  const ev=ST.events[ST.selected];
  ev.leadIdx=idx;
  ev.fing=recommend(ev.pitches[idx].midi);
  saveFingering();
  render();
}
export function setStringForSelected(strIdx){
  if(ST.selected==null) return;
  const ev=ST.events[ST.selected];
  const midi=ev.pitches[ev.leadIdx].midi;
  const off=midi-OPEN[strIdx];
  const z=zoneOf(off);
  ev.fing={str:strIdx, off, frac:fracOf(off), zone:z.zone, klass:z.klass, finger:fingerHint(off), manual:true};
  saveFingering();
  render();
}
export function setFinger(fn){
  if(ST.selected==null) return;
  const ev=ST.events[ST.selected];
  if(!ev.fing) return;
  ev.fing.finger=fn; ev.fing.manual=true;
  saveFingering();
  render();
}
export function setPref(p){
  ST.pref=p;
  document.querySelectorAll('.pref').forEach(b=>b.classList.toggle('on', b.dataset.pref===p));
  saveSettings();
  /* スケール練習は開始音（オクターブ）がポジションで変わるので作り直す */
  if(ST.mode==='scale' && ST.events.length){ genScale(true); return; }
  ST.events.forEach(ev=>{ if(ev.fing && !ev.fing.manual) ev.fing=recommend(ev.pitches[ev.leadIdx].midi); });
  saveFingering();
  render();
}
export function playableCount(shift){
  let ok=0;
  for(const ev of ST.parsed.events){
    for(const p of ev.pitches){ if(optionsFor(p.midi+12*shift).length) { ok++; break; } }
  }
  return ok;
}
/* 自動：全音が演奏可能になる最小のシフト（0を優先） */
export function autoShift(){
  const total=ST.parsed.events.length;
  for(const sh of [0,-1,1,-2,2]){ if(playableCount(sh)===total) return sh; }
  let best=0, bestN=-1;
  for(const sh of [0,-1,1,-2,2]){ const n=playableCount(sh); if(n>bestN){bestN=n; best=sh;} }
  return best;
}
/* そのシフトで全音が演奏可能か */
export function shiftOK(sh){
  if(!ST.parsed) return false;
  return ST.parsed.events.every(ev=>
    ev.pitches.some(p=> optionsFor(p.midi+12*sh).length>0));
}
export function applyOctave(){
  if(!ST.parsed) return;
  /* スケール練習は移調しない（コピー練習の設定を持ち込まない） */
  const sh = (ST.mode==='scale') ? 0
           : (ST.octave==='auto') ? autoShift() : (parseInt(ST.octave,10)||0);
  ST.octShift=sh;
  ST.events = ST.parsed.events.map((e,i)=>{
    const pitches=e.pitches.map(p=>({midi:p.midi+12*sh, name:midiName(p.midi+12*sh)}));
    return {id:i, measure:e.measure, onset:e.onset, dur:e.dur, pitches,
            leadIdx:Math.min(e.leadIdx, pitches.length-1), fing:null};
  });
  ST.events.forEach(ev=>{ ev.fing=recommend(ev.pitches[ev.leadIdx].midi); });
  const el=document.getElementById('octInfo');
  if(el){
    const out=ST.events.filter(e=>!e.fing).length;
    const lbl = sh===0 ? '原曲どおり' : (sh>0? `+${sh} オクターブ` : `${sh} オクターブ`);
    el.textContent = ST.events.length
      ? `${lbl}${ST.octave==='auto'?'（自動判定）':''}` + (out? ` / 音域外 ${out}音` : ' / 全音が演奏可能')
      : '';
  }
  /* 全音が収まらないボタンは非アクティブに */
  document.querySelectorAll('.oct').forEach(b=>{
    const v=b.dataset.oct;
    if(v==='auto'){ b.disabled=false; return; }
    b.disabled = !shiftOK(parseInt(v,10));
  });
}
export function setOctave(v){
  ST.octave = (v==='auto') ? 'auto' : parseInt(v,10);
  document.querySelectorAll('.oct').forEach(b=> b.classList.toggle('on', String(b.dataset.oct)===String(ST.octave)));
  syncDock();
  if(!ST.parsed) return;
  const at = ST.playing ? currentBeat() : null;
  applyOctave();
  loadFingering();
  ST.selected=Math.min(ST.selected||0, ST.events.length-1);
  saveSettings();
  render();
  if(at!=null) startPlay(at, true);      /* 再生中はその位置で組み直す（カウントなし） */
}

/* 譜面をセット（共通処理：運指の自動復元・ループ範囲の初期化） */
export function setScore(parsed, scoreName){
  ST.parsed=parsed;
  ST.measures=parsed.measures || [];
  ST.beatsPerMeasure=parsed.beatsPerMeasure || 4;
  ST.scoreName=scoreName || '';
  ST.selected=0; ST.current=null; ST.lastScrollId=null; ST.playhead=0;
  applyOctave();

  const restored=loadFingering();

  const mCount=ST.measures.length || 1;
  ST.loop.from=Math.min(ST.loop.from, mCount);
  ST.loop.to  =Math.min(Math.max(ST.loop.to, ST.loop.from), mCount);
  syncLoopUI();
  render();
  zoomFitPositions(5);                 /* 読み込み時：0〜5F が画面に収まるように */
  ST.lastScrollId=null;
  scrollBoardToActive();               /* ハイポジション始まりでも最初の音が画面に入るように */
  return restored;
}
export function genScale(quiet){
  try{
    setMidiFile(null); renderTracks();
    const parsed=buildScaleEvents(ST.keyRoot, ST.scaleType, ST.scaleOct);
    const label=`${NOTE_NAMES[ST.keyRoot]} ${SCALE_LABEL[ST.scaleType]} ${ST.scaleOct}oct`;
    setScore(parsed, 'scale:'+label);
    /* ループ範囲はスケール全体（ON/OFFは利用者に任せる） */
    ST.loop.from=1;
    ST.loop.to=parsed.measures.length || 1;
    syncLoopUI();
    updateTransport();
    if(!quiet){
      closeDrawer();
      toast(`${label}（${parsed.events.length}音 / ${parsed.measures.length}小節）`);
      setTimeout(()=>{ if(ST.mode==='scale' && ST.events.length) startPlay(0); }, 260);  /* 生成したら自動再生 */
    }
  }catch(e){ toast('生成できません：'+e.message); }
}
/* 画面左下ドックの表示（テンポ値・オクターブ値・ループON）を状態に合わせる */
export function syncDock(){
  const t=document.getElementById('dkTempoV');
  if(t) t.textContent=ST.tempo;
  const o=document.getElementById('dkOctV');
  if(o){
    const v=ST.octave;
    o.textContent = (v==='auto') ? '自動' : (v===0 || v==='0') ? '原曲' : (v>0 ? '+'+v : String(v));
  }
  const l=document.getElementById('dkLoop');
  if(l) l.classList.toggle('on', ST.loop.on);
}
export function syncLoopUI(){
  const mCount=ST.measures.length;
  const fromEl=document.getElementById('loopFrom');
  const toEl=document.getElementById('loopTo');
  fromEl.value=ST.loop.from;
  toEl.value=ST.loop.to;
  fromEl.max=Math.max(1,mCount);
  toEl.max=Math.max(1,mCount);
  document.getElementById('loopSw').classList.toggle('on', ST.loop.on);
  const info=document.getElementById('loopInfo');
  if(ST.mode==='scale'){
    info.textContent = mCount ? `スケール全体（${mCount} 小節）を繰り返します` : 'スケールを生成すると有効になります';
  } else {
    info.textContent = mCount ? `全 ${mCount} 小節（${ST.loop.from}〜${ST.loop.to} を繰り返し）` : '譜面を読み込むと小節数が出ます';
  }
  syncDock();
}
export function setLoopRange(){
  const mCount=Math.max(1, ST.measures.length);
  let f=parseInt(document.getElementById('loopFrom').value,10) || 1;
  let t=parseInt(document.getElementById('loopTo').value,10) || 1;
  f=Math.max(1, Math.min(f, mCount));
  t=Math.max(f, Math.min(t, mCount));
  ST.loop.from=f; ST.loop.to=t;
  syncLoopUI();
  if(ST.playing) startPlay();     /* 再生中なら新しい範囲で組み直し */
}
export function setZoom(z){
  ST.zoom=z;
  applyZoom();
  saveSettings();
  ST.lastScrollId=null;
  scrollBoardToActive();
}
export function updateChrome(){
  const playable = (ST.mode==='scale' || ST.mode==='score') && ST.events.length>0;
  const fab=document.getElementById('fab');
  fab.style.display = playable ? 'inline-flex' : 'none';
  fab.disabled=!playable; fab.textContent=ST.playing?'■':'▶'; fab.classList.toggle('playing', ST.playing);
  document.getElementById('gear').style.display = ST.mode ? 'inline-flex' : 'none';
  document.getElementById('storeInfo').textContent =
    Store.ok ? '編集した運指は自動保存されます（この端末に保存）'
             : 'この環境では自動保存が使えません。「書き出し」でJSON保存してください';
}
