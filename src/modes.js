/*
  modes.js — 全体統括（render）・モード制御・UI同期・オクターブ・運指編集。
  元 cello-finger.html より無改変で移植。
    render                                   … L1338–1384
    renderLegend/applyMode/setMode/レイアウト同期(mq等)/renderNow/renderEdit … L1515–1662
    stripSignature/updateStripActive/renderStrip/scrollStripToActive（運指ストリップ） … L1690–1732
    selectEvent/setLead/setStringForSelected/setFinger/setPref（音符選択・運指編集） … L1827–1867
    playableCount/autoShift/shiftOK/applyOctave/setOctave/setScore（オクターブ・譜面セット） … L2750–2829
    ※ genScale（スケール生成統括）はスケール練習の廃止にともない削除した
    syncLoopUI/setLoopRange（ループUI）          … L3402–3427
    setZoom                                    … L3448–3454
    updateChrome（FAB/gear/保存表示）            … L3481–3490
  drawer（saveSettings/loadFingering/syncSettingsUI/closeDrawer 等）・songs（renderTracks/loadSample）は
  次バッチで作成。それまで実行時は未解決（構文・元一致は検証済み）。
*/
import { ST, volProfileKey } from './state.js';
import { fracOf, midiName, zoneOf, fingerHint, strFingerText, OPEN, STRNAME, tt, FINGER_TABLE, FINGER_HIGH, setNowLine, ZONES } from './util.js';
import { applyZoom, optionsFor, optionsForAll, recommend, renderBoard, scrollBoardToActive, zoomFitPositions, FB, slurGroupOf, slurCommonStrings } from './fingerboard.js';
import { renderStaff } from './notation.js';
import { currentBeat, startPlay, stopPlay, updateTransport } from './audio/scheduler.js';
import { paintTunerDots, startTuner, stopTuner, TUN } from './tuner.js';
import { warmAudio } from './audio/context.js';
import { toast } from './dom.js';
import { closeDrawer, openDrawer, saveSettings, saveFingering, loadFingering, syncSettingsUI, setScoreSub, Store } from './drawer.js';
import { loadSample, renderTracks, midiFile, setMidiFile } from './songs.js';
/* 採点ゲーム。モードの出入りで課題曲一覧を作り直し、録音中に抜けたら止める */
import { abortGame, renderGameSongs, syncStartBtn, maybeShowGameIntro } from './game.js';
/* メトロノーム。モードを離れるときは必ず止める（裏で鳴り続けないように） */
import { enterMetro, stopMetro } from './metronome.js';
/* お気に入り（指板の左上のハート）。曲が変わるたびに出し入れする */
import { syncFavBtn } from './favorites.js';

export function render(){
  const picker  = document.getElementById('picker');
  const emptyEl = document.getElementById('empty');

  /* モード未選択 → 入口画面 */
  if(!ST.mode){
    picker.style.display='flex';
    emptyEl.style.display='none';
    renderBoard(null);
    setNowLine(tt('msg.pick_mode'));
    renderLegend(); updateTransport(); updateChrome();
    return;
  }
  picker.style.display='none';

  /* メトロノーム → 指板も譜面も使わない。#metroView が画面をまるごと受け持つ
     （出し入れは applyMode の data-m）。ここでは下の「譜面がありません」を出さないようにする */
  if(ST.mode==='metro'){
    emptyEl.style.display='none';
    renderBoard(null);
    setNowLine(tt('ui.mode_metro_s'));
    renderLegend(); updateTransport(); updateChrome();
    return;
  }

  /* チューナーモード → 譜面なしで指板＋検出表示 */
  if(ST.mode==='tuner'){
    emptyEl.style.display='none';
    renderBoard(null);
    setNowLine(TUN.on ? tt('msg.tuner_on_hint') : tt('msg.tuner_off_hint'));
    paintTunerDots(ST.tunerMidi, ST.tunerCents);
    renderLegend(); updateTransport(); updateChrome();
    return;
  }

  if(!ST.events.length){
    emptyEl.style.display='flex';
    emptyEl.innerHTML = (ST.mode==='game') ? tt('msg.empty_game_html') : tt('msg.empty_score_html');
    renderBoard(null);
    setNowLine((ST.mode==='game') ? tt('msg.nowline_game') : tt('ui.nowline'));
    renderEdit(null);
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
  if(!ST.mode || ST.mode==='tuner' || ST.mode==='metro' || !ST.events.length){ lg.style.display='none'; return; }
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
  warmAudio();
  if(ST.mode===mode) return;
  /* メトロノームは stopPlay より先に止める。stopPlay が音のバスを外してしまうと、
     鳴っていないのに ST.metroOn だけ立ったままになり、練習時間が増え続けるため。 */
  stopMetro();
  stopPlay();

  /* チューナーモードを離れる → マイクとシートを必ず閉じる */
  if(ST.mode==='tuner' && mode!=='tuner') stopTuner();
  /* 採点ゲームを離れる → 録音していたら止める（点数は出さずに捨てる） */
  if(ST.mode==='game' && mode!=='game') abortGame(true);

  ST.mode=mode;
  ST.events=[]; ST.measures=[]; ST.selected=null; ST.current=null;
  ST.slurs=[]; ST.slurComps=[];
  ST.lastScrollId=null; ST.scoreName=''; ST.scoreTitle='';
  renderScoreTitle();
  /* 譜面を手放したので、指板の左上のハートと、公開/非公開・削除も引っ込める。
     メトロノームは画面をまるごと覆うので、ここに古いボタンが浮いたままだと押せてしまう。
     公開/非公開・削除の出し入れは uploads.js が この知らせを受けて行う。 */
  syncFavBtn();
  try{ window.dispatchEvent(new CustomEvent('gs:scorechanged')); }catch(e){}
  setMidiFile(null); renderTracks();
  applyMode();
  ST.vol = ST.volProfiles[volProfileKey()];      /* モード別の音量プロファイル */
  syncSettingsUI();
  syncSheet();

  if(mode==='score'){
    /* 曲を練習は伴奏コードを持つ曲だけ伴奏可。モードに入った時点では毎回OFFから始める */
    ST.enjoy=false;
    document.getElementById('enjoySw').classList.remove('on');
    loadSample(true);                       /* プリセット：G線上のアリア */
    /* 入口（モード選択）から入った時は、案内モーダルを挟まずに左ドロワーを開く。
       曲の選び方（曲を選ぶ / 譜面を読み込む）はドロワーの子タブにそのまま並んでいる。
       ドロワー内のタブ切替（keepDrawer）は、すでに開いているので何もしない。 */
    if(!keepDrawer){ setScoreSub('songs'); openDrawer(); }
    toast(tt('msg.hint_swan'));

  } else if(mode==='game'){
    /* 採点ゲームは伴奏を使わない（メトロノームだけを聞いて弾く） */
    ST.enjoy=false;
    document.getElementById('enjoySw').classList.remove('on');
    renderGameSongs();
    syncStartBtn();
    /* 課題曲の一覧はドロワーの中にあるので、入口から入った時は開いて見せる */
    if(!keepDrawer) openDrawer();
    render();
    toast(tt('msg.hint_game'));
    maybeShowGameIntro();                   /* 初めて開いたときだけ説明を出す */

  } else if(mode==='metro'){
    /* メトロノームは譜面を持たない。伴奏も使わないので必ずOFFに戻す */
    ST.enjoy=false;
    document.getElementById('enjoySw').classList.remove('on');
    /* 操作は画面のまん中にあるので、ドロワー内のタブから入った時（keepDrawer）も必ず閉じる。
       開いたままだとテンポの数字も拍のランプも隠れてしまうため。 */
    closeDrawer();
    render();
    enterMetro();

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

/* 上部バーの上段＝いま開いている譜面の名前。
   ST.scoreName（'song:sakura' 等）は運指の保存キー用の内部IDなので画面には出さず、
   表示用の ST.scoreTitle（曲名・ファイル名・スケール名）を出す。
   下段の押さえる音の情報（renderNow）とは別の行なので、演奏中も消えない。 */
export function renderScoreTitle(){
  const el=document.getElementById('scoretitle');
  if(!el) return;
  const t = ST.scoreTitle || '';
  /* 曲名が無いときは中身ごと空にする（:empty で枠と ✎ を消しているため） */
  if(!t){ el.textContent=''; el.classList.remove('marquee'); return; }
  /* 収まらないときだけ流す。中身を span で包み、はみ出す幅ぶんだけ動かす。
     同じ文言を2つ並べて隙間なくつなげる方式は、短い曲名だと不自然に見えるのでとらない。 */
  el.classList.remove('marquee');
  el.innerHTML = '<span class="st-in"></span>';
  const inner = el.firstChild;
  inner.textContent = t;
  /* 直後だとレイアウトが確定していないことがあるので、1フレーム待ってから測る */
  requestAnimationFrame(()=>{
    if(!el.isConnected || inner.textContent !== (ST.scoreTitle||'')) return;
    const over = inner.scrollWidth - el.clientWidth;
    if(over > 4){
      /* 端で少し止めたいので、動く量とかける時間から往復の割合を決める */
      el.style.setProperty('--mq-shift', (-(over + 8)) + 'px');
      el.style.setProperty('--mq-time', Math.max(6, (over + 8) / 18).toFixed(1) + 's');
      el.classList.add('marquee');
    }
  });
}
export function renderNow(ev){
  if(!ev || !ev.fing){ setNowLine(''); return; }
  const lead=ev.pitches[ev.leadIdx];
  setNowLine(`<b>${lead.name}</b> · ${strFingerText(ev.fing.str, ev.fing.off, ev.fing.finger)} · ${ev.fing.zone}`, true);
}

/* 運指編集シートの端の ＜ ＞ ：前後の音（ST.events の隣の要素）へ移す。
   disabled にするかどうかと、押したときにどの音へ行くかは、いま出ている音の
   ev.id（＝ ST.events の添字。src/songs.js が振っているのでそのまま使える）を
   ボタンの data-id に持たせておき、src/main.js のクリック配線から読む。 */
function syncEditNav(ev){
  const prevBtn=document.getElementById('editPrev');
  const nextBtn=document.getElementById('editNext');
  if(!prevBtn || !nextBtn) return;
  const has = !!ev && ST.events.length>1;
  prevBtn.disabled = !has || ev.id<=0;
  nextBtn.disabled = !has || ev.id>=ST.events.length-1;
  if(ev){ prevBtn.dataset.id=ev.id; nextBtn.dataset.id=ev.id; }
}
export function renderEdit(ev){
  const el=document.getElementById('edit');
  syncEditNav(ev);
  if(!ev){ el.innerHTML=tt('msg.edit_empty_html'); return; }
  const lead=ev.pitches[ev.leadIdx];

  /* 音名は .cur-n でひとまとめにする。こうしておくと .cur を flex にしたときに
     音名の並び（和音のときの空白区切り）を崩さずに、ボタンだけ右端へ寄せられる。 */
  let cur=`<div class="cur"><span class="cur-n">`;
  ev.pitches.forEach((p,i)=>{
    cur += `<span class="${i===ev.leadIdx?'lead':'oth'}">${p.name}</span>${i<ev.pitches.length-1?' ':''}`;
  });
  cur += `</span>`;
  cur += `<button type="button" class="reset-one-btn" data-action="reset-one">${tt('msg.fing_reset_one')}</button>`;
  cur+=`</div>`;

  /* リード選択（和音のとき） */
  let leadGrp='';
  if(ev.pitches.length>1){
    leadGrp = `<div class="grp"><div class="lbl">${tt('msg.grp_lead')}</div><div class="chips">`
      + ev.pitches.map((p,i)=>`<div class="chip lead-pick ${i===ev.leadIdx?'on':''}" data-idx="${i}">${p.name}</div>`).join('')
      + `</div></div>`;
  }

  /* 弦選択：1〜4弦すべて。同じ音名なら1・2オクターブ上下の位置も候補に出す
     （音域の端の音でも、どの弦のどのポジションで押さえるかを選べるようにするため）。 */
  const opts = optionsForAll(lead.midi);
  const octBadge = oc => oc ? `<i class="oc">${oc>0?'+':'−'}${Math.abs(oc)/12}oct</i>` : '';
  const strGrp = `<div class="grp"><div class="lbl">${tt('msg.grp_str')}</div><div class="chips">`
    + opts.map(o=>{
        const on = (ev.fing && ev.fing.str===o.str && ev.fing.off===o.off) ? 'on' : '';
        return `<div class="chip str-pick ${on}${o.oct?' alt-oct':''}" data-str="${o.str}" data-oct="${o.oct}">`
             + `${tt('msg.str_chip', STRNAME[o.str])}${octBadge(o.oct)}<small>${o.zone}</small></div>`;
      }).join('')
    + `</div></div>`;

  /* 指の目安 */
  const fingerOpts = (ev.fing && ev.fing.off===0) ? [FINGER_TABLE[0]] : ['1','2','3','4',FINGER_HIGH];
  const fingGrp = `<div class="grp"><div class="lbl">${tt('msg.grp_finger')}</div><div class="chips">`
    + fingerOpts.map(fn=>`<div class="chip fing-pick ${ev.fing&&ev.fing.finger===fn?'on':''}" data-fin="${fn}">${fn}</div>`).join('')
    + `</div></div>`;

  el.innerHTML = `<h3>${tt('msg.sel_note')}</h3>${cur}${leadGrp}${strGrp}${fingGrp}`
    + `<div class="hint">${tt('msg.edit_hint')}<br>${tt('msg.edit_oct_hint')}</div>`;
}
export let stripSig='';
/* 譜面編集（item6）で音程だけ変えたときは stripSignature が変わらず nchip が古いまま
   残るので、外から署名を消して強制再構築できるようにする。 */
export function invalidateStrip(){ stripSig=''; }
export function stripSignature(){
  return [ST.events.length, ST.scoreName, ST.octShift,
          ST.events.map(e=> e.fing ? (e.fing.str+''+(e.fing.finger ?? '')) : '-').join(',')].join('|');
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
    /* 指番号がまだ決まっていない音は、弦の名前だけ出す */
    const sub = f ? (f.finger ? `${STRNAME[f.str]}·${f.finger}` : STRNAME[f.str]) : tt('msg.out_of_range');
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
  scrollBoardToActive(true);
}
export function setStringForSelected(strIdx, oct){
  if(ST.selected==null) return;
  const oc=(typeof oct==='number' && !isNaN(oct)) ? oct : 0;

  /* スラーの中なら、群の全音を同じ弦へ一緒に動かす（スラーは同じ弦、が前提）。
     群のどれか1音でもその弦・オクターブに乗らないときは動かさない（候補側でも出さない）。 */
  const grp=slurGroupOf(ST.selected);
  if(grp){
    const set=[];
    for(let i=grp[0]; i<=grp[1]; i++){
      const ev=ST.events[i]; const midi=ev.pitches[ev.leadIdx].midi;
      const off=(midi+oc)-OPEN[strIdx];
      if(off<0 || off>FB.maxOff) return;              /* 群が乗らない＝何もしない */
      set.push([i, off]);
    }
    for(const [i, off] of set){
      const z=zoneOf(off);
      ST.events[i].fing={str:strIdx, off, frac:fracOf(off), zone:z.zone, klass:z.klass, finger:null, manual:true};
    }
    saveFingering();
    render();
    scrollBoardToActive(true);
    return;
  }

  const ev=ST.events[ST.selected];
  const midi=ev.pitches[ev.leadIdx].midi;
  /* oct は元の高さからの半音差（0 / ±12 / ±24）。指板に出す位置だけを動かす
     （鳴る音は譜面のまま＝ev.pitches は触らない）。 */
  const off=(midi+oc)-OPEN[strIdx];
  if(off<0 || off>FB.maxOff) return;
  const z=zoneOf(off);
  /* 弦を変えるとポジションが変わり、押さえる指も変わる。番号は入れずに選び直してもらう */
  ev.fing={str:strIdx, off, frac:fracOf(off), zone:z.zone, klass:z.klass, finger:null, manual:true};
  saveFingering();
  render();
  /* 押さえる位置が遠くへ移ることがある（別の弦・別のオクターブ）。
     同じ音のままなので force を立てないとスクロールが省かれる。 */
  scrollBoardToActive(true);
}
export function setFinger(fn){
  if(ST.selected==null) return;
  const ev=ST.events[ST.selected];
  if(!ev.fing) return;
  ev.fing.finger=fn; ev.fing.manual=true;
  saveFingering();
  render();
}
/* 選択中の1音だけを推奨運指へ戻す（「個別リセット」用。全体リセットは drawer.js の resetFingering） */
export function resetSelectedFingering(){
  if(ST.selected==null) return;
  const ev=ST.events[ST.selected];
  if(!ev) return;
  const grp=slurGroupOf(ST.selected);
  if(grp){
    /* スラーは群ごと自動（同じ弦）へ戻す */
    for(let i=grp[0]; i<=grp[1]; i++){ const e=ST.events[i]; e.leadIdx=e.pitches.length-1; e.fing=recommend(e.pitches[e.leadIdx].midi); }
    applySlurStrings();
    saveFingering();
    render();
    scrollBoardToActive(true);
    toast(tt('msg.fing_reset_one_done'));
    return;
  }
  ev.leadIdx=ev.pitches.length-1;
  ev.fing=recommend(ev.pitches[ev.leadIdx].midi);
  saveFingering();
  render();
  scrollBoardToActive(true);
  toast(tt('msg.fing_reset_one_done'));
}
export function setPref(p){
  ST.pref=p;
  document.querySelectorAll('.pref').forEach(b=>b.classList.toggle('on', b.dataset.pref===p));
  saveSettings();
  ST.events.forEach(ev=>{ if(ev.fing && !ev.fing.manual) ev.fing=recommend(ev.pitches[ev.leadIdx].midi); });
  applySlurStrings();          /* 推奨ポジを変えても、スラー群は同じ弦に揃え直す */
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
/* 試すシフトの並び。左にあるものほど優先する（原曲のオクターブを最優先） */
const OCT_SHIFTS=[0,-1,1,-2,2];
/* ロー〜ミドルポジションの上限（開放弦からの半音数）。
   ZONES は楽器ごとに config/{楽器}.php から降りてくるので、klass が 'high' になる
   ひとつ手前の帯の maxOff を採る（チェロ13 / ヴァイオリン・ヴィオラ12 / コントラバス11）。 */
export function comfortMaxOff(){
  let m=0;
  for(const z of ZONES){
    if(z.klass==='high') break;
    if(z.maxOff==null) return FB.maxOff;
    m=Math.max(m, z.maxOff);
  }
  return m || FB.maxOff;
}
/* そのシフトで「ロー〜ミドルで押さえられる」音の数。
   どれか1本の弦で comfortMaxOff 以内に収まれば、その音は数に入れる。 */
export function comfortCount(shift){
  const lim=comfortMaxOff();
  let ok=0;
  for(const ev of ST.parsed.events){
    for(const p of ev.pitches){
      if(optionsFor(p.midi+12*shift).some(o=> o.off<=lim)){ ok++; break; }
    }
  }
  return ok;
}
/* ハイポジションに追い出してよい割合。これを超えるならもう1オクターブ下げる */
const COMFORT_TOL=0.15;
/* 自動：指板に収まるシフトのうち、ロー〜ミドルが基準になるものを選ぶ。
   ・まず「全音が指板に収まる」シフトだけに絞る（従来どおり）
   ・その中から、ハイポジション送りの音が1割5分以下に収まる最初のものを採る
     （並びは原曲＝0 に近い順なので、必要なぶんだけ下げた結果になる）
   ・どれも収まらなければ、いちばんロー〜ミドルに入るものを採る
   例）チェロの「白鳥」は原曲のままだと8割がハイポジションになるため -1 が選ばれる。 */
export function autoShift(){
  const total=ST.parsed.events.length;
  if(!total) return 0;
  const fit=OCT_SHIFTS.filter(sh=> playableCount(sh)===total);
  const list=fit.length ? fit : OCT_SHIFTS.slice();
  for(const sh of list){ if(total-comfortCount(sh) <= total*COMFORT_TOL) return sh; }
  let best=list[0], bestN=-1;
  for(const sh of list){ const n=comfortCount(sh); if(n>bestN){ bestN=n; best=sh; } }
  return best;
}
/* そのシフトで全音が演奏可能か */
export function shiftOK(sh){
  if(!ST.parsed) return false;
  const ok = ST.parsed.events.every(ev=>
    ev.pitches.some(p=> optionsFor(p.midi+12*sh).length>0));
  if(!ok) return false;
  /* スラーの連結成分は「そのオクターブで同じ弦に乗る」ものだけ許す（乗らないオクターブは押せなくする）。 */
  const comps=mergeSlurs(validSlurs(ST.parsed.slurs, ST.parsed.events.length));
  for(const [a,b] of comps){
    const leads=[]; for(let i=a;i<=b;i++){ const ev=ST.parsed.events[i]; leads.push(ev.pitches[ev.leadIdx].midi+12*sh); }
    if(!slurCommonStrings(leads, 0).length) return false;
  }
  return true;
}
/* スラー群の妥当性チェック（0<=a<b<n だけ通す）。 */
function validSlurs(list, n){
  if(!Array.isArray(list)) return [];
  const out=[];
  for(const g of list){ const a=g[0], b=g[1]; if(Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b<n&&a<b) out.push([a,b]); }
  return out;
}
/* 入れ子/隣接（端共有を含む）のスラーを連結成分にまとめる。まとめないと、あとから来た群が
   先の群の一部を別の弦へ書き換えて「群が2本の弦に割れる」ため。まとめれば必ず1本に乗る。 */
function mergeSlurs(list){
  const iv=(list||[]).map(g=>[g[0],g[1]]).sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
  const out=[];
  for(const [a,b] of iv){
    const last=out[out.length-1];
    if(last && a<=last[1]) last[1]=Math.max(last[1], b);   /* 端共有(a==last[1])も含めてまとめる */
    else out.push([a,b]);
  }
  return out;
}
/* 群の中でどの弦を使うか。推奨ポジ設定（ロー/ミドル/ハイ）に合わせて選ぶ。 */
function pickSlurString(strs, leads){
  const score=(i)=>{
    let sc=0;
    for(const m of leads){ const off=m-OPEN[i];
      if(ST.pref==='low')       sc+=off;                 /* offが小さいほど良い */
      else if(ST.pref==='high') sc-=off;                 /* offが大きいほど良い */
      else                      sc+=Math.abs(off-10);    /* off=10 に近いほど良い */
    }
    return sc;
  };
  let best=strs[0], bs=score(strs[0]);
  for(const i of strs){ const sc=score(i); if(sc<bs){ bs=sc; best=i; } }
  return best;
}
/* スラー群の主音を同じ弦へ揃える（手直しでない音だけ）。 */
function applySlurStrings(){
  const S=ST.slurComps; if(!S || !S.length) return;
  for(const g of S){
    const leads=[]; let anyManual=false;
    for(let i=g[0]; i<=g[1]; i++){ const ev=ST.events[i]; if(!ev) { leads.length=0; break; } if(ev.fing && ev.fing.manual) anyManual=true; leads.push(ev.pitches[ev.leadIdx].midi); }
    if(!leads.length || anyManual) continue;          /* 手直しがあれば触らない（人の指定を尊重） */
    const strs=slurCommonStrings(leads, 0);
    if(!strs.length) continue;                          /* どの弦にも乗らない＝各音の推奨のまま */
    const pick=pickSlurString(strs, leads);
    for(let i=g[0]; i<=g[1]; i++){
      const ev=ST.events[i]; const off=ev.pitches[ev.leadIdx].midi-OPEN[pick]; const z=zoneOf(off);
      ev.fing={str:pick, off, frac:fracOf(off), zone:z.zone, klass:z.klass, finger:null, manual:false};
    }
  }
}
export function applyOctave(){
  if(!ST.parsed) return;
  /* 前の曲で選んだオクターブが、この曲では指板に収まらないことがある。
     押せないボタン（下で disabled にする）が選ばれたまま残らないよう「自動」へ戻す。 */
  if(ST.octave!=='auto' && !shiftOK(parseInt(ST.octave,10)||0)) ST.octave='auto';
  const sh = (ST.octave==='auto') ? autoShift() : (parseInt(ST.octave,10)||0);
  ST.octShift=sh;
  ST.events = ST.parsed.events.map((e,i)=>{
    const pitches=e.pitches.map(p=>({midi:p.midi+12*sh, name:midiName(p.midi+12*sh)}));
    return {id:i, measure:e.measure, onset:e.onset, dur:e.dur, pitches,
            leadIdx:Math.min(e.leadIdx, pitches.length-1), fing:null};
  });
  ST.events.forEach(ev=>{ ev.fing=recommend(ev.pitches[ev.leadIdx].midi); });
  /* スラー群を取り込み、群の全音を同じ弦へ揃える（自動運指のときだけ。手直しは loadFingering が後で上書き）。 */
  ST.slurs = validSlurs(ST.parsed.slurs, ST.events.length);
  ST.slurComps = mergeSlurs(ST.slurs);
  applySlurStrings();
  const el=document.getElementById('octInfo');
  if(el){
    const out=ST.events.filter(e=>!e.fing).length;
    const lbl = sh===0 ? tt('msg.oct_orig') : (sh>0? tt('msg.oct_up', sh) : tt('msg.oct_down', sh));
    el.textContent = ST.events.length
      ? `${lbl}${ST.octave==='auto'?tt('msg.oct_auto_suffix'):''}` + (out? tt('msg.oct_out', out) : tt('msg.oct_all_ok'))
      : '';
  }
  /* 全音が指板に収まらないオクターブは押せなくする（音域外の音を含む譜面を作らない）。
     選択中の印も付け直す（上で「自動」へ戻した場合に、古い印が残らないように）。 */
  document.querySelectorAll('.oct').forEach(b=>{
    const v=b.dataset.oct;
    b.disabled = (v==='auto') ? false : !shiftOK(parseInt(v,10));
    b.classList.toggle('on', String(v)===String(ST.octave));
  });
  syncDock();
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

/* 譜面をセット（共通処理：運指の自動復元・ループ範囲の初期化）
   scoreName … 運指の保存キーに使う内部ID（画面には出さない）
   title     … 上部バーに出す表示名。省略時は内部IDを出さずに空にする */
export function setScore(parsed, scoreName, title){
  /* 各読み込み経路は setScore の直前に setTempo() を呼ぶので、ここが譜面本来のテンポ */
  ST.tempoOrig=ST.tempo;
  ST.parsed=parsed;
  ST.songChords=null;                  /* 伴奏コードは譜面ごと。持つ曲は setScore の後で入れ直す */
  ST.measures=parsed.measures || [];
  ST.beatsPerMeasure=parsed.beatsPerMeasure || 4;
  ST.beatUnit=(parsed.beatUnit>0) ? parsed.beatUnit : 1;
  ST.scoreName=scoreName || '';
  ST.scoreTitle=title || '';
  renderScoreTitle();
  syncFavBtn();                        /* 曲が変わったので、左上のハートを合わせる */
  /* 指板の「公開/非公開」と「削除」も曲に合わせて出し入れする。
     uploads.js は modes.js を読み込んでいるので、直接呼ばず知らせるだけにする（相互参照を作らない）。 */
  try{ window.dispatchEvent(new CustomEvent('gs:scorechanged')); }catch(e){}
  ST.selected=0; ST.current=null; ST.lastScrollId=null; ST.playhead=0;
  applyOctave();

  const restored=loadFingering();

  const mCount=ST.measures.length || 1;
  /* 読み込み直後は全体（1〜最終小節）。前の曲で指定した範囲を持ち越さない
     ＝28小節の曲を開いたのに前回の 1〜8 が残っている、という状態を作らない。
     ON/OFF は利用者に任せる */
  ST.loop.from=1;
  ST.loop.to  =mCount;
  syncLoopUI();
  render();
  zoomFitPositions(5);                 /* 読み込み時：0〜5F が画面に収まるように */
  ST.lastScrollId=null;
  scrollBoardToActive();               /* ハイポジション始まりでも最初の音が画面に入るように */
  return restored;
}
/* スケール練習（markScaleDirty / clearScaleDirty / genScale）は廃止した。
   同じ内容は「曲を練習する」の課題曲『Cメジャースケール』
   （public/songs/c_major_scale.json）で弾ける。 */
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
  /* 伴奏ボタン：曲を練習は伴奏コードを持つ譜面のときだけ出す */
  const ej=document.getElementById('enjoySw');
  if(ej){
    const hasChords = Array.isArray(ST.songChords) && ST.songChords.length>0;
    ej.classList.toggle('m-hide', !(ST.mode==='score' && hasChords));
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
  info.textContent = mCount ? tt('msg.loop_range', mCount, ST.loop.from, ST.loop.to) : tt('msg.loop_need_score');
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
/* 開始小節・終了小節を、いま読んでいる譜面の全体（1〜最終小節）へ戻す。
   ・ループのON/OFFは触らない（OFFにすると syncLoopUI() が小節指定を disabled にして
     .field2.off で薄くするので、リセットした途端に入力欄が消えたように見えるため）
   ・ST の初期値 1〜4 は譜面を読む前の値。28小節の曲に対して 4 へ戻しても意味がないので、
     実際の小節数を使う。譜面がまだ無いときだけ初期値の 4 のままにする。 */
export function resetLoop(){
  const mCount=ST.measures.length;
  ST.loop.from=1;
  ST.loop.to  = mCount>0 ? mCount : 4;
  syncLoopUI();
  saveSettings();
  if(ST.playing) startPlay();     /* 再生中なら組み直し（setLoopRange と同じ） */
}
export function setZoom(z){
  ST.zoom=z;
  applyZoom();
  saveSettings();
  ST.lastScrollId=null;
  scrollBoardToActive();
}
export function updateChrome(){
  const playable = (ST.mode==='score') && ST.events.length>0;
  const fab=document.getElementById('fab');
  fab.style.display = playable ? 'inline-flex' : 'none';
  fab.disabled=!playable; fab.textContent=ST.playing?'■':'▶'; fab.classList.toggle('playing', ST.playing);
  /* 頭出し（▶ の上）。▶ と同じ条件で出し入れする（▶ が無い画面に単独で残らないように） */
  const cue=document.getElementById('cue');
  if(cue){ cue.style.display = playable ? 'inline-flex' : 'none'; cue.disabled=!playable; }
  document.getElementById('gear').style.display = ST.mode ? 'inline-flex' : 'none';
  /* 「運指の保存」欄は廃止したので無いのが普通（戻したときだけ書き換わる） */
  const si=document.getElementById('storeInfo');
  if(si) si.textContent = Store.ok ? tt('msg.store_ok') : tt('msg.store_ng');
}
