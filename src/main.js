/*
  main.js — エントリポイント：全モジュールを結線し初期化する。
  素の ES モジュール（ビルド無し、type=module は defer 相当＝DOM構築後に実行）。
  CSS は index.html の <link> で読み込む。
  配線本体（on(...) 群・補助関数・末尾の初期化）は
  元 cello-finger.html L3522–3794 より無改変で移植（on() 定義 L3502–3521 は dom.js へ移設済みのため除外）。
*/
import { ST, volProfileKey, DEFAULT_VOL } from './state.js';
import { on, toast } from './dom.js';
import { applyZoom, hideHoldDot, holdActive, holdStart, holdStop, holdUpdate, pluckString, pointToPos, scrollBoardToActive, showHoldDot, zoomFit } from './fingerboard.js';
import { applyMode, genScale, render, selectEvent, setFinger, setLead, setMode, setOctave, setStringForSelected, setZoom, syncLayoutClass, syncLoopUI, setLoopRange, setPref } from './modes.js';
import { acquireWake, beatFromSeekEvent, currentBeat, isRotated, releaseWake, seekTo, setSeekHead, startPlay, stopPlay, setTempo } from './audio/scheduler.js';
import { applyVolumes } from './audio/context.js';
import { importFingering, loadSettings, saveSettings, syncSettingsUI, closeGear, toggleGear, exportFingering, resetFingering, openDrawer, closeDrawer, openPdfOverlay, closePdfOverlay, openDockModal, closeDockModal } from './drawer.js';
import { loadSong, loadSongManifest, selectTrack, skipToStart, loadScoreFile } from './songs.js';
import { loadScales } from './scale.js';
import { startTuner, stopTuner, pickTunerString, toggleReference, syncReferenceUI, TUN } from './tuner.js';
import { pdfDoc, pdfPage, setPdfPage, openPdf, renderPdfPage } from './pdf.js';
import { tt } from './util.js';

/* ===== イベント配線 ＋ 初期化（元 L3522–3794、無改変）===== */
/* --- 取りこぼしていた基本配線（元 L3509–3520。fab=再生ボタン等） --- */
on('file','change', e=>{ if(e.target.files[0]) loadScoreFile(e.target.files[0]); e.target.value=''; });
on('pdffile','change', e=>{ if(e.target.files[0]) openPdf(e.target.files[0]); e.target.value=''; });
on('fab','click', ()=>{ if(ST.playing) stopPlay(); else startPlay(); });
on('menu','click', openDrawer);
on('drawerClose','click', closeDrawer);
on('scrim','click', closeDrawer);
on('pdfOpen','click', openPdfOverlay);
on('pdfClose','click', closePdfOverlay);
on('tempo','input', e=>{ setTempo(+e.target.value, true); saveSettings(); });
/* 数値入力：打ち込み途中（空欄・1桁）で勝手に補正しない。確定時にだけ範囲へ丸める */
on('tempoNum','input', e=>{
  const v=parseInt(e.target.value,10);
  if(!isFinite(v) || v<30 || v>160) return;
  setTempo(v, true); saveSettings();
});
on('tempoNum','change', e=>{
  const v=parseInt(e.target.value,10);
  setTempo(isFinite(v) ? v : ST.tempo, true);
  e.target.value=ST.tempo;
  saveSettings();
});
/* ±1 の微調整とリセット。範囲の丸めは setTempo 側でやるのでここでは素通し */
on('tempoDn','click', ()=>{ setTempo(ST.tempo-1, true); saveSettings(); });
on('tempoUp','click', ()=>{ setTempo(ST.tempo+1, true); saveSettings(); });
/* リセット先は「読み込んだ譜面のテンポ」（setScore で控えている） */
on('tempoReset','click', ()=>{ setTempo(ST.tempoOrig || 80, true); saveSettings(); });
document.querySelectorAll('.pref').forEach(b=> b.addEventListener('click', ()=> setPref(b.dataset.pref)));
on('pdfprev','click', ()=>{ if(pdfPage>1){ setPdfPage(pdfPage-1); renderPdfPage();} });
on('pdfnext','click', ()=>{ if(pdfDoc&&pdfPage<pdfDoc.numPages){ setPdfPage(pdfPage+1); renderPdfPage();} });

/* ===== 運指ストリップ：スワイプ＋タップ選択 ===== */
let sDrag=null, sMoved=false;
on('strip','pointerdown', e=>{
  const el=document.getElementById('strip');
  sDrag={x:e.clientX, y:e.clientY, left:el.scrollLeft, mouse:(e.pointerType==='mouse')};
  sMoved=false;
});
on('strip','pointermove', e=>{
  if(!sDrag) return;
  const dx=isRotated() ? (e.clientY - sDrag.y) : (e.clientX - sDrag.x);
  if(Math.abs(dx)>5){
    sMoved=true;
    ST.stripHold=Date.now();                      /* 手動操作中は自動追従を止める */
    if(sDrag.mouse){                              /* マウスはブラウザが慣性スクロールしないので手動 */
      const el=document.getElementById('strip');
      el.style.scrollBehavior='auto';
      el.scrollLeft=sDrag.left - dx;
      el.style.scrollBehavior='';
    }
  }
});
function endStripDrag(){ sDrag=null; }
on('strip','pointerup', endStripDrag);
on('strip','pointercancel', ()=>{ sDrag=null; sMoved=true; ST.stripHold=Date.now(); });
on('strip','scroll', ()=>{ if(sDrag) ST.stripHold=Date.now(); });

on('strip','click', e=>{
  if(sMoved){ sMoved=false; return; }            /* スワイプ中は選択しない */
  const chip=e.target.closest('.nchip');
  if(!chip) return;
  const id=+chip.dataset.id;
  if(ST.playing){                                /* 再生中：そこから再生し直す */
    const ev=ST.events[id];
    if(ev){ ST.playhead=ev.onset; startPlay(ev.onset, true); }
    return;
  }
  selectEvent(id);
  scrollBoardToActive();
  if(ST.mode==='score') openEditSheet();         /* 👇 運指を変更できます */
});

/* 五線譜のタップ */
on('staffview','click', e=>{
  const n=e.target.closest('.nh');
  if(!n) return;
  const id=+n.dataset.id;
  if(ST.playing){ const ev=ST.events[id]; if(ev){ ST.playhead=ev.onset; startPlay(ev.onset, true); } return; }
  selectEvent(id);
  if(ST.mode==='score') openEditSheet();
});

/* 再生メーター：タップ／ドラッグでシーク */
let seeking=false;
on('seek','pointerdown', e=>{
  if(!ST.events.length) return;
  seeking=true;
  const seekEl=document.getElementById('seek');
  try{ seekEl.setPointerCapture(e.pointerId); }catch(err){}
  setSeekHead(beatFromSeekEvent(e));
});
on('seek','pointermove', e=>{
  if(!seeking) return;
  setSeekHead(beatFromSeekEvent(e));
});
function endSeek(e){
  if(!seeking) return;
  seeking=false;
  seekTo(beatFromSeekEvent(e));
}
on('seek','pointerup', endSeek);
on('seek','pointercancel', ()=>{ seeking=false; });
/* 編集パネルのタップ（委譲） */
on('edit','click', e=>{
  const lead=e.target.closest('.lead-pick'); if(lead){ setLead(+lead.dataset.idx); return; }
  const str=e.target.closest('.str-pick');   if(str){ setStringForSelected(+str.dataset.str); return; }
  const fin=e.target.closest('.fing-pick');  if(fin){ setFinger(fin.dataset.fin); return; }
});
/* 指板の候補○タップ（委譲） */
on('fbsvg','click', e=>{
  const c=e.target.closest('.opt'); if(!c) return;
  /* 再生を止めた直後は selected も current も null になり、○を押しても無反応だった。
     指板に描いている音符（render の focusId と同じ規則）を対象にする。 */
  if(ST.selected==null) ST.selected = (ST.current!=null) ? ST.current : (ST.events.length ? 0 : null);
  if(ST.selected!=null) setStringForSelected(+c.dataset.str);
});

/* ===== 指板：押している間だけ鳴らす（複数指・複数弦対応） =====
   実際のチェロと同じく、「同じ弦」に複数の指が触れているときは、ブリッジ側
   ＝開放弦からの半音数（off）が大きい指の音が鳴る。弦が違えば互いに独立して
   同時に鳴る（重音）。スマホ画面を指板に見立てて押さえ替えの練習ができる。 */
const fbPtrs=new Map();                          /* pointerId -> {str, off, midi} */
function fbDominant(str){
  let best=null;
  fbPtrs.forEach(p=>{ if(p.str===str && (!best || p.off>best.off)) best=p; });
  return best;
}
/* その弦のブリッジ側の指に合わせて発音・表示を作り直す（弦ごとに独立） */
function fbSyncString(str, pluck){
  const cur=fbDominant(str);
  if(!cur){ holdStop(str); hideHoldDot(str); return; }
  if(holdActive(str)) holdUpdate(str, cur.midi); else holdStart(str, cur.midi);
  showHoldDot(cur);
  if(pluck) pluckString(cur.str, cur.off, 1);
}
on('fbsvg','pointerdown', e=>{
  if(e.target.closest('.opt')) return;          /* 候補○は弦変更が優先 */
  const pos=pointToPos(e);
  if(!pos) return;
  const prev=fbDominant(pos.str);
  fbPtrs.set(e.pointerId, pos);
  ST.holding=true;
  const fbEl=document.getElementById('fbsvg');
  try{ fbEl.setPointerCapture(e.pointerId); }catch(err){}
  const cur=fbDominant(pos.str);
  /* その弦のブリッジ側が入れ替わった時だけ弾き直す（ナット側の指を足しても鳴り続ける） */
  fbSyncString(pos.str, !prev || cur.off!==prev.off);
});
on('fbsvg','pointermove', e=>{
  const old=fbPtrs.get(e.pointerId);
  if(!old) return;
  const pos=pointToPos(e);
  if(!pos) return;
  fbPtrs.set(e.pointerId, pos);
  if(pos.str!==old.str) fbSyncString(old.str, false);   /* 抜けた弦：残った指に戻す／居なければ止める */
  fbSyncString(pos.str, pos.str!==old.str);             /* 移った弦：またいだ時だけ弾き直す */
});
function endHold(e){
  const p=fbPtrs.get(e.pointerId);
  if(!p) return;
  fbPtrs.delete(e.pointerId);
  fbSyncString(p.str, false);                   /* まだ指が残っていればその音に戻す／無ければ停止 */
  if(!fbPtrs.size) ST.holding=false;
}
on('fbsvg','pointerup', endHold);
on('fbsvg','pointercancel', endHold);
on('fbsvg','pointerleave', endHold);

/* ===== 運指編集シート ===== */
function openEditSheet(){
  if(ST.mode!=='score' || !ST.events.length) return;
  document.getElementById('editSheet').classList.add('open');
}
function closeEditSheet(){ document.getElementById('editSheet').classList.remove('open'); }
on('editClose','click', closeEditSheet);

/* ===== 設定（歯車） ===== */
on('viewSeg','click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  ST.view=b.dataset.view;
  syncSettingsUI(); saveSettings(); render();
  if(ST.view==='staff'){
    if(!ST.landscape){ ST.landAuto=true; setLandscape(true); toast(tt('msg.staff_landscape')); }
  } else {
    if(ST.landAuto){ ST.landAuto=false; setLandscape(false); }   /* 自動でONにした分だけ戻す */
  }
});
/* 横画面（ランドスケープ）: 端末の向きロックを試み、無理ならCSSで回転 */
async function setLandscape(on){
  ST.landscape=on;
  document.getElementById('landSw').classList.toggle('on', on);
  document.body.classList.toggle('force-landscape', on);
  syncLayoutClass();
  saveSettings();
  if(on){
    try{
      if(document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      if(screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    }catch(e){ /* iOS等は非対応。CSS回転でカバー */ }
  }else{
    try{ if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}
    try{ if(document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); }catch(e){}
  }
  setTimeout(()=>{ applyZoom(); render(); }, 260);
}
on('landSw','click', ()=>{ ST.landAuto=false; setLandscape(!ST.landscape); });
on('gearClose','click', closeGear);
on('volReset','click', ()=>{
  const key=volProfileKey();
  Object.assign(ST.volProfiles[key], DEFAULT_VOL[key]);
  syncSettingsUI(); applyVolumes(); saveSettings();
  toast(tt('msg.vol_reset_done', tt(key==='scale'?'ui.mode_scale':'ui.mode_score')));
});
on('countSw','click', ()=>{
  ST.countIn=!ST.countIn;
  document.getElementById('countSw').classList.toggle('on', ST.countIn);
  saveSettings();
});
on('awakeSw','click', ()=>{
  ST.keepAwake=!ST.keepAwake;
  document.getElementById('awakeSw').classList.toggle('on', ST.keepAwake);
  if(!ST.keepAwake) releaseWake(true); else if(ST.playing) acquireWake();
  saveSettings();
  if(ST.keepAwake && !navigator.wakeLock) toast(tt('msg.wakelock_video'));
});

on('fretSw','click', ()=>{
  ST.frets=!ST.frets;
  document.getElementById('fretSw').classList.toggle('on', ST.frets);
  saveSettings(); render();
});
/* 言語切替（/{言語}/{楽器}/ へ移動。URLは PHP が window.APP.langUrls に出力） */
on('langSel','change', e=>{
  ST.lang=e.target.value; saveSettings();
  const url=(window.APP && window.APP.langUrls) ? window.APP.langUrls[ST.lang] : null;
  if(url) location.href=url;
});
document.querySelectorAll('.oct').forEach(b=> b.addEventListener('click', ()=> setOctave(b.dataset.oct)));
[['volMaster','master'],['volLead','lead'],['volDrum','drum'],['volBass','bass'],
 ['volChord','chord'],['volMetro','metro']].forEach(([id,key])=>{
  on(id,'input', e=>{
    ST.volProfiles[volProfileKey()][key]=(+e.target.value||0)/100;
    ST.vol=ST.volProfiles[volProfileKey()];
    document.getElementById(id+'V').textContent=e.target.value;
    applyVolumes(); saveSettings();
  });
});

/* ===== 練習モードの切替 ===== */
on('picker','click', e=>{
  const c=e.target.closest('.pk-card');
  if(c) setMode(c.dataset.mode);
});
on('modeSeg','click', e=>{
  const b=e.target.closest('button');
  if(b) setMode(b.dataset.mode, true);   /* ドロワー内タブ切替では横ウィンドウを閉じない */
});

/* ===== コピー練習：子タブ（曲を選ぶ / 譜面を読み込む） ===== */
function setScoreSub(sub){
  document.querySelectorAll('#scoreSubSeg button').forEach(b=> b.classList.toggle('on', b.dataset.sub===sub));
  document.querySelectorAll('.subpanel').forEach(p=> p.classList.toggle('m-hide', p.dataset.sub!==sub));
}
on('scoreSubSeg','click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  setScoreSub(b.dataset.sub);
});
on('songBtns','click', e=>{
  const b=e.target.closest('.songbtn'); if(!b || b.disabled) return;
  const id=b.dataset.song;
  if(!id){ toast(tt('msg.soon')); return; }
  loadSong(id, false);
});

/* ===== スケール練習 ===== */
on('scaleRoot','change', e=>{ ST.keyRoot=parseInt(e.target.value,10)||0; saveSettings(); });
on('scaleType','change', e=>{ ST.scaleType=e.target.value; saveSettings(); });
on('scaleOct','change', e=>{ ST.scaleOct=parseInt(e.target.value,10)||2; saveSettings(); });
on('scaleGen','click', ()=> genScale(false));

on('loopSw','click', ()=>{
  ST.loop.on=!ST.loop.on;
  syncLoopUI(); saveSettings();
  if(ST.playing) startPlay(currentBeat(), true);
});
on('loopFrom','change', setLoopRange);
on('loopTo','change', setLoopRange);
/* 小節の ▲▼。値を1つ動かすだけで、範囲の丸め（1〜小節数・終了>=開始）は setLoopRange に任せる */
function stepLoop(id, d){
  const el=document.getElementById(id);
  if(!el) return;
  el.value=(parseInt(el.value,10) || 1) + d;
  setLoopRange();
}
on('loopFromDn','click', ()=> stepLoop('loopFrom', -1));
on('loopFromUp','click', ()=> stepLoop('loopFrom',  1));
on('loopToDn','click',   ()=> stepLoop('loopTo',   -1));
on('loopToUp','click',   ()=> stepLoop('loopTo',    1));

on('enjoySw','click', ()=>{
  ST.enjoy=!ST.enjoy;
  document.getElementById('enjoySw').classList.toggle('on', ST.enjoy);
  saveSettings();
  if(ST.playing) startPlay(currentBeat());
});

/* ===== 画面左下ドック：テンポ / オクターブ / ループ（伴奏は上の enjoySw） ===== */
on('dkTempo','click', ()=> openDockModal('mTempo'));
on('instBtn','click', ()=> openDockModal('mInst'));   /* ドロワー見出しの楽器名 → 楽器切り替え */
on('dkOct','click',   ()=> openDockModal('mOct'));
on('dkLoop','click',  ()=> openDockModal('mLoop'));
on('dockScrim','click', closeDockModal);
document.querySelectorAll('[data-dkclose]').forEach(b=> b.addEventListener('click', closeDockModal));

/* ===== ゲーム / チューナー ===== */
on('micSw','click', async ()=>{
  if(TUN.on){ stopTuner(); return; }
  await startTuner();
  /* ONになったらドロワーを閉じてチューナーを見せる（ドロワーが被って読めないため）。
     許可が下りなかった時は開いたままにして、ヒントを読めるようにする。 */
  if(TUN.on) closeDrawer();
});
/* チューナーの✕：マイクを止めて入口画面（モード選択）へ戻る。stopTuner は setMode 側で呼ばれる */
on('tunerClose','click', ()=> setMode(null));
/* 弦チップ：その弦の開放音を基準にする（自動判定の取り違えで締めすぎるのを防ぐ）。
   同じ弦をもう一度押すと自動判定に戻る。 */
on('tunRef','click', toggleReference);
syncReferenceUI();                       /* 起動時に基準音のラベルを埋める */
document.querySelectorAll('.tun-str [data-str]').forEach(el=>{
  el.addEventListener('click', ()=> pickTunerString(+el.dataset.str));
});

/* ===== 歯車：指板の表示設定 ===== */
on('gear','click', toggleGear);
on('gearScrim','click', closeGear);
on('zoom','input', e=> setZoom((+e.target.value||100)/100));
on('zoomIn','click',   ()=> setZoom(ST.zoom*1.25));
on('zoomOut','click',  ()=> setZoom(ST.zoom/1.25));
on('zoomFit','click',  zoomFit);
on('zoomReset','click',()=> setZoom(1));

/* ===== MIDIトラック選択 ===== */
on('trackList','click', e=>{
  const row=e.target.closest('.trow');
  if(row) selectTrack(+row.dataset.i, true);      /* 名前タップで再生 */
});
on('skipStart','click', skipToStart);

/* ===== 運指の保存 ===== */
on('fingExport','click', exportFingering);
on('fingReset','click', resetFingering);
on('fingFile','change', e=>{
  if(e.target.files[0]) importFingering(e.target.files[0]);
  e.target.value='';
});

window.addEventListener('resize', ()=>{ if(pdfDoc && document.getElementById('pdfOverlay').classList.contains('open')) renderPdfPage(); });

/* 初期描画
   スケール定義（public/scales/scales.json）と曲一覧（public/songs/manifest.json）は
   外部読み込みのため、loadSettings() より先に await する
   （保存済みの scaleType を SCALES と照合するため／scaleType の <option> が必要なため）。 */
(async ()=>{
  await Promise.all([ loadScales(), loadSongManifest() ]);
  loadSettings();
  /* 表示言語は URL（/{言語}/{楽器}/）を正とする。保存値で選択欄がずれないように上書き */
  if(window.APP && window.APP.lang) ST.lang=window.APP.lang;
  applyMode();
  syncSettingsUI();
  syncLoopUI();
  render();
  applyZoom();
})();
window.addEventListener('orientationchange', ()=> setTimeout(applyZoom, 250));
