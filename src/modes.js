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
import { fracOf, midiName, zoneOf, fingerHint, strFingerText, NOTE_NAMES, OPEN, STRNAME, tt, FINGER_TABLE, FINGER_HIGH } from './util.js';
import { applyZoom, optionsFor, recommend, renderBoard, scrollBoardToActive, zoomFitPositions } from './fingerboard.js';
import { renderStaff } from './notation.js';
import { buildScaleEvents, SCALE_LABEL } from './scale.js';
import { currentBeat, startPlay, stopPlay, updateTransport } from './audio/scheduler.js';
import { paintTunerDots, startTuner, stopTuner, TUN } from './tuner.js';
import { warmAudio } from './audio/context.js';
import { toast } from './dom.js';
import { closeDrawer, saveSettings, saveFingering, loadFingering, syncSettingsUI, openScoreStart, Store } from './drawer.js';
import { loadSample, renderTracks, midiFile, setMidiFile } from './songs.js';

export function render(){
  const picker  = document.getElementById('picker');
  const emptyEl = document.getElementById('empty');

  /* モード未選択 → 入口画面 */
  if(!ST.mode){
    picker.style.display='flex';
    emptyEl.style.display='none';
    renderBoard(null);
    document.getElementById('nowline').textContent=tt('msg.pick_mode');
    renderLegend(); updateTransport(); updateChrome();
    return;
  }
  picker.style.display='none';

  /* チューナーモード → 譜面なしで指板＋検出表示 */
  if(ST.mode==='tuner'){
    emptyEl.style.display='none';
    renderBoard(null);
    document.getElementById('nowline').textContent = TUN.on ? tt('msg.tuner_on_hint') : tt('msg.tuner_off_hint');
    paintTunerDots(ST.tunerMidi, ST.tunerCents);
    renderLegend(); updateTransport(); updateChrome();
    return;
  }

  if(!ST.events.length){
    emptyEl.style.display='flex';
    emptyEl.innerHTML = (ST.mode==='score')
      ? tt('msg.empty_score_html')
      : tt('msg.empty_scale_html');
    renderBoard(null);
    document.getElementById('nowline').textContent = (ST.mode==='score') ? tt('ui.nowline') : tt('msg.nowline_scale');
    document.getElementById('edit').innerHTML=tt('msg.edit_empty_html');
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
  const chordItem = (ST.mode==='score') ? `<span><i class="dot chord"></i>${tt('msg.lg_chord')}</span>` : '';
  lg.innerHTML = '<span><i class="dot lead"></i>' + (ST.mode==='score' ? tt('msg.lg_lead') : tt('msg.lg_press')) + '</span>'
    + chordItem
    + `<span><i class="dot alt"></i>${tt('msg.lg_alt')}</span>`;
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
  if(mode==='game'){ toast(tt('msg.game_soon')); return; }
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
    toast(tt('msg.hint_scale'));

  } else if(mode==='score'){
    /* 曲を練習は伴奏コードを持つ曲だけ伴奏可。モードに入った時点では毎回OFFから始める */
    ST.enjoy=false;
    document.getElementById('enjoySw').classList.remove('on');
    loadSample(true);                       /* プリセット：G線上のアリア */
    /* 入口（モード選択）から入った時は、曲の選び方を案内するモーダルを出す。
       ドロワー内のタブ切替（keepDrawer）は、そのままドロワーに選択肢が出ているので不要。 */
    if(!keepDrawer){ closeDrawer(); openScoreStart(); }
    toast(tt('msg.hint_swan'));

  } else if(mode==='tuner'){
    ST.enjoy=false;
    document.getElementById('enjoySw').classList.remove('on');
    ST.tunerMidi=null; ST.tunerCents=0;
    if(!keepDrawer) closeDrawer();
    render();
    /* マイクがONになったらドロワーを閉じてチューナーを見せる（被って読めないため）。
       startTuner は許可待ちの非同期なので、ONを確認してから閉じる。
       許可が下りなかった時は開いたまま＝スイッチとヒントを触れる。 */
    if(TUN.on) closeDrawer();
    else startTuner().then(()=>{ if(TUN.on) closeDrawer(); });

  } else {
    /* モード未選択（＝入口画面に戻る）。チューナーの✕はここへ来る */
    if(!keepDrawer) closeDrawer();
    render();
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
  el.innerHTML = msg + `<div><button id="micRetry">${tt('msg.mic_allow')}</button></div>`;
  const btn=document.getElementById('micRetry');
  if(btn) btn.addEventListener('click', ()=> startTuner());
}
export function micUnavailableReason(){
  const secure = (typeof isSecureContext!=='undefined') ? isSecureContext : (location.protocol==='https:' || location.hostname==='localhost');
  if(!secure || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    return tt('msg.mic_file_html')
         + tt('msg.mic_https_html')
         + tt('msg.mic_example_html');
  }
  return null;
}

export function renderNow(ev){
  const el=document.getElementById('nowline');
  if(!ev || !ev.fing){ el.innerHTML=''; return; }
  const lead=ev.pitches[ev.leadIdx];
  el.innerHTML = `<b>${lead.name}</b> · ${strFingerText(ev.fing.str, ev.fing.off, ev.fing.finger)} · ${ev.fing.zone}`;
}

export function renderEdit(ev){
  const el=document.getElementById('edit');
  if(!ev){ el.innerHTML=tt('msg.edit_empty_html'); return; }
  const lead=ev.pitches[ev.leadIdx];

  let cur=`<div class="cur">`;
  ev.pitches.forEach((p,i)=>{
    cur += `<span class="${i===ev.leadIdx?'lead':'oth'}">${p.name}</span>${i<ev.pitches.length-1?' ':''}`;
  });
  cur+=`</div>`;

  /* リード選択（和音のとき） */
  let leadGrp='';
  if(ev.pitches.length>1){
    leadGrp = `<div class="grp"><div class="lbl">${tt('msg.grp_lead')}</div><div class="chips">`
      + ev.pitches.map((p,i)=>`<div class="chip lead-pick ${i===ev.leadIdx?'on':''}" data-idx="${i}">${p.name}</div>`).join('')
      + `</div></div>`;
  }

  /* 弦選択 */
  const opts = optionsFor(lead.midi);
  const strGrp = `<div class="grp"><div class="lbl">${tt('msg.grp_str')}</div><div class="chips">`
    + opts.map(o=>`<div class="chip str-pick ${ev.fing&&ev.fing.str===o.str?'on':''}" data-str="${o.str}">${tt('msg.str_chip', STRNAME[o.str])}<small>${o.zone}</small></div>`).join('')
    + `</div></div>`;

  /* 指の目安 */
  const fingerOpts = (ev.fing && ev.fing.off===0) ? [FINGER_TABLE[0]] : ['1','2','3','4',FINGER_HIGH];
  const fingGrp = `<div class="grp"><div class="lbl">${tt('msg.grp_finger')}</div><div class="chips">`
    + fingerOpts.map(fn=>`<div class="chip fing-pick ${ev.fing&&ev.fing.finger===fn?'on':''}" data-fin="${fn}">${fn}</div>`).join('')
    + `</div></div>`;

  el.innerHTML = `<h3>${tt('msg.sel_note')}</h3>${cur}${leadGrp}${strGrp}${fingGrp}`
    + `<div class="hint">${tt('msg.edit_hint')}</div>`;
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
    const sub = f ? `${STRNAME[f.str]}·${f.finger}` : tt('msg.out_of_range');
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
    const lbl = sh===0 ? tt('msg.oct_orig') : (sh>0? tt('msg.oct_up', sh) : tt('msg.oct_down', sh));
    el.textContent = ST.events.length
      ? `${lbl}${ST.octave==='auto'?tt('msg.oct_auto_suffix'):''}` + (out? tt('msg.oct_out', out) : tt('msg.oct_all_ok'))
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
  /* 各読み込み経路は setScore の直前に setTempo() を呼ぶので、ここが譜面本来のテンポ */
  ST.tempoOrig=ST.tempo;
  ST.parsed=parsed;
  ST.songChords=null;                  /* 伴奏コードは譜面ごと。持つ曲は setScore の後で入れ直す */
  ST.measures=parsed.measures || [];
  ST.beatsPerMeasure=parsed.beatsPerMeasure || 4;
  ST.beatUnit=(parsed.beatUnit>0) ? parsed.beatUnit : 1;
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
      toast(tt('msg.scale_built', label, parsed.events.length, parsed.measures.length));
      setTimeout(()=>{ if(ST.mode==='scale' && ST.events.length) startPlay(0); }, 260);  /* 生成したら自動再生 */
    }
  }catch(e){ toast(tt('msg.gen_failed', e.message)); }
}
/* 画面左下ドックの表示（テンポ値・オクターブ値・ループON）を状態に合わせる */
export function syncDock(){
  const t=document.getElementById('dkTempoV');
  if(t) t.textContent=ST.tempo;
  const o=document.getElementById('dkOctV');
  if(o){
    const v=ST.octave;
    o.textContent = (v==='auto') ? tt('ui.oct_auto') : (v===0 || v==='0') ? tt('ui.oct_orig') : (v>0 ? '+'+v : String(v));
  }
  const l=document.getElementById('dkLoop');
  if(l) l.classList.toggle('on', ST.loop.on);
  /* 伴奏ボタン：スケール練習は常に。曲を練習は伴奏コードを持つ譜面のときだけ出す */
  const ej=document.getElementById('enjoySw');
  if(ej){
    const hasChords = Array.isArray(ST.songChords) && ST.songChords.length>0;
    ej.classList.toggle('m-hide', !(ST.mode==='scale' || (ST.mode==='score' && hasChords)));
  }
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
  /* ループOFFのあいだは小節指定を触れなくする（押しても何も起きない入力を残さない） */
  ['loopFrom','loopTo','loopFromDn','loopFromUp','loopToDn','loopToUp'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.disabled=!ST.loop.on;
  });
  document.querySelector('#mLoop .field2')?.classList.toggle('off', !ST.loop.on);
  const info=document.getElementById('loopInfo');
  if(ST.mode==='scale'){
    info.textContent = mCount ? tt('msg.loop_scale_all', mCount) : tt('msg.loop_need_scale');
  } else {
    info.textContent = mCount ? tt('msg.loop_range', mCount, ST.loop.from, ST.loop.to) : tt('msg.loop_need_score');
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
    Store.ok ? tt('msg.store_ok')
             : tt('msg.store_ng');
}
