/*
  main.js — エントリポイント：全モジュールを結線し初期化する。
  素の ES モジュール（ビルド無し、type=module は defer 相当＝DOM構築後に実行）。
  CSS は index.html の <link> で読み込む。
  配線本体（on(...) 群・補助関数・末尾の初期化）は
  元 cello-finger.html L3522–3794 より無改変で移植（on() 定義 L3502–3521 は dom.js へ移設済みのため除外）。
*/
import { ST, volProfileKey, DEFAULT_VOL } from './state.js';
import { on, toast } from './dom.js';
import { applyZoom, centerBoardH, chirpEvent, hideHoldDot, holdActive, holdStart, holdStop, holdUpdate, pluckString, pointToPos, scrollBoardToActive, showHoldDot, zoomFit } from './fingerboard.js';
import { applyMode, render, selectEvent, setFinger, setLead, setMode, setOctave, setStringForSelected, setZoom, syncLayoutClass, syncLoopUI, setLoopRange, resetLoop, resetSelectedFingering } from './modes.js';
import { acquireWake, beatFromSeekEvent, currentBeat, flashMeasure, isRotated, playRange, releaseWake, seekPreview, seekTo, setSeekHead, startPlay, stopPlay, setTempo } from './audio/scheduler.js';
import { applyVolumes } from './audio/context.js';
import { loadSettings, saveSettings, syncSettingsUI, syncCountSeg, closeGear, toggleGear, openGearPage, openDrawer, closeDrawer, openDockModal, closeDockModal, setScoreSub, resetFingering } from './drawer.js';
import { loadSong, SONGS, loadSongManifest, selectTrack, setTrackRole, setTrackInst, skipToStart, loadScoreFile, setSongQuery, setSongPage, songListPage,
         renderSongList, setFavFilter, favFilterOn } from './songs.js';
/* お気に入り（指板の左上のハート／曲一覧の絞り込み） */
import { toggleFavCurrent, syncFavBtn, syncFavFilterBtn, reloadFavs } from './favorites.js';
import { loadScales } from './scale.js';
import { startTuner, stopTuner, pickTunerString, toggleReference, syncReferenceUI, TUN } from './tuner.js';
import { tt } from './util.js';
import { initPractice } from './practice.js';
import { initPracticeUI, openPractice, prevMonth, nextMonth, refreshPracticeLine, renderCalendar } from './practice-ui.js';
import { initAccount, openAccount, showSignin, showMe, showSignup, showForgot, showPasswd, showDelete, togglePassword, doLogin, doSignup,
         doResend, doForgot, doPasswd, doLogout, doDestroy, googleSignin, askLogin, askSkip,
         setSaveApply, armSave, setSaveWatcher } from './account.js';
import { openContact, sendContact, syncKind } from './contact.js';
import { initUploads, openUpload, deleteUpload, upDupOverwrite, upDupAddNew, upDupCancel, openRename, doRename, curUploadItem, syncShareDeleteBtns,
         setUpFavFilter, upFavFilterOn } from './uploads.js';
/* みんなの曲（利用者が共有した楽譜）。一覧に混ぜて出す／公開する／削除依頼／管理 */
import { initShares, loadShared, openShare, doShare, unshareSong,
         openAdmin, setAdminQuery, setAdminPage, adminListPage, adminAction } from './shares.js';
import { pickGameSong, startGame, beginRun, cancelGameCheck, abortGame, retryGame, renderGameSongs } from './game.js';
/* メトロノーム（採点ゲームがあった場所）。画面ごと src/metronome.js が受け持つ */
import { initMetro, stopMetro } from './metronome.js';
import './pwa.js';   /* Service Worker 登録と「ホーム画面に追加」。配線は pwa.js 側で完結 */

/* ===== イベント配線 ＋ 初期化（元 L3522–3794、無改変）===== */
/* --- 取りこぼしていた基本配線（元 L3509–3520。fab=再生ボタン等） --- */
on('file','change', e=>{ if(e.target.files[0]) loadScoreFile(e.target.files[0]); e.target.value=''; });
on('fab','click', ()=>{
  if(ST.playing){ stopPlay(true); return; }   /* 停止位置にフォーカス＋小節表示（item1/2） */
  /* 運指編集シートが開いていると指板が暗幕で暗いまま。弾き始めるときは閉じる */
  closeEditSheet();
  startPlay();
});
/* 頭出し（▶ の上）。いま再生する範囲の先頭へ戻す。
   ループ中はループの先頭、そうでなければ曲の先頭（playRange().sB）。
   seekTo は再生中なら組み直し、止まっていれば次の ▶ の開始位置だけを動かす。 */
on('cue','click', ()=>{
  if(!ST.events.length) return;
  /* 頭出しは「もう一度そこから弾き直す」操作なので、設定がONなら開始カウントを鳴らす
     （withCount=true。再生していないときは次の ▶ で鳴る）。 */
  seekTo(playRange().sB, true);
});
on('menu','click', openDrawer);
on('drawerClose','click', closeDrawer);
on('scrim','click', closeDrawer);
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
/* 推奨ポジション（.pref）のUIは廃止＝配線も外した。
   ST.pref / setPref() は modes.js に残してあるので、戻すときはここも戻す。 */

/* ===== 運指ストリップ：スワイプ＋タップ選択 ===== */
let sDrag=null, sMoved=false, sHoldTimer=0, sLong=false;
on('strip','pointerdown', e=>{
  const el=document.getElementById('strip');
  sDrag={x:e.clientX, y:e.clientY, left:el.scrollLeft, mouse:(e.pointerType==='mouse')};
  sMoved=false; sLong=false;
  /* 長押し＝編集ドロワー展開。タップは「この位置を選ぶ」だけにするので、編集はここで開く。
     押している間にスワイプしたら（pointermove で >5px）長押しは取り消す。 */
  clearTimeout(sHoldTimer); sHoldTimer=0;
  const chip=e.target.closest('.nchip');
  if(chip && !ST.playing){
    const id=+chip.dataset.id;
    sHoldTimer=setTimeout(()=>{
      sHoldTimer=0; sLong=true;
      selectEvent(id); scrollBoardToActive();
      if(ST.mode==='score') openEditSheet();
    }, 500);
  }
});
on('strip','pointermove', e=>{
  if(!sDrag) return;
  const dx=isRotated() ? (e.clientY - sDrag.y) : (e.clientX - sDrag.x);
  if(Math.abs(dx)>5){
    sMoved=true;
    if(sHoldTimer){ clearTimeout(sHoldTimer); sHoldTimer=0; }   /* 動いた＝長押しは取り消す */
    ST.stripHold=Date.now();                      /* 手動操作中は自動追従を止める */
    if(sDrag.mouse){                              /* マウスはブラウザが慣性スクロールしないので手動 */
      const el=document.getElementById('strip');
      el.style.scrollBehavior='auto';
      el.scrollLeft=sDrag.left - dx;
      el.style.scrollBehavior='';
    }
  }
});
function endStripDrag(){ sDrag=null; if(sHoldTimer){ clearTimeout(sHoldTimer); sHoldTimer=0; } }
on('strip','pointerup', endStripDrag);
on('strip','pointercancel', ()=>{ sDrag=null; sMoved=true; if(sHoldTimer){ clearTimeout(sHoldTimer); sHoldTimer=0; } ST.stripHold=Date.now(); });
on('strip','scroll', ()=>{ if(sDrag) ST.stripHold=Date.now(); });

on('strip','click', e=>{
  if(sLong){ sLong=false; return; }              /* 長押しで編集を開いた直後はタップ選択しない */
  if(sMoved){ sMoved=false; return; }            /* スワイプ中は選択しない */
  const chip=e.target.closest('.nchip');
  if(!chip) return;
  const id=+chip.dataset.id;
  if(ST.playing){                                /* 再生中：そこから再生し直す */
    const ev=ST.events[id];
    if(ev){ ST.playhead=ev.onset; startPlay(ev.onset, true); }
    return;
  }
  selectEvent(id);                               /* タップ＝この位置を選ぶだけ（▶ でここから再生） */
  scrollBoardToActive();
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
  const b=beatFromSeekEvent(e);
  setSeekHead(b); flashMeasure(b);          /* 移動先の小節を一瞬だけ大きく出す */
  seekPreview(b);                           /* ストリップ・指板もその場で追従させる */
});
on('seek','pointermove', e=>{
  if(!seeking) return;
  const b=beatFromSeekEvent(e);
  setSeekHead(b); flashMeasure(b);
  seekPreview(b);
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
  const str=e.target.closest('.str-pick');   if(str){ setStringForSelected(+str.dataset.str, +(str.dataset.oct||0)); return; }
  const fin=e.target.closest('.fing-pick');  if(fin){ setFinger(fin.dataset.fin); return; }
  const one=e.target.closest('.reset-one-btn'); if(one){ resetSelectedFingering(); return; }
});
/* 指板の候補○タップ（委譲） */
on('fbsvg','click', e=>{
  const c=e.target.closest('.opt'); if(!c) return;
  /* 再生を止めた直後は selected も current も null になり、○を押しても無反応だった。
     指板に描いている音符（render の focusId と同じ規則）を対象にする。 */
  if(ST.selected==null) ST.selected = (ST.current!=null) ? ST.current : (ST.events.length ? 0 : null);
  if(ST.selected!=null) setStringForSelected(+c.dataset.str, +(c.dataset.oct||0));
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
/* 開いているあいだは指板の上に黒い暗幕（#editScrim）を出す。
   左ドロワー（.scrim）・歯車（.gscrim）と同じ作法で、暗幕をタップしても閉じる。 */
function openEditSheet(){
  if(ST.mode!=='score' || !ST.events.length) return;
  document.getElementById('editSheet').classList.add('open');
  const sc=document.getElementById('editScrim'); if(sc) sc.classList.add('show');
}
function closeEditSheet(){
  document.getElementById('editSheet').classList.remove('open');
  const sc=document.getElementById('editScrim'); if(sc) sc.classList.remove('show');
}
on('editClose','click', closeEditSheet);
on('editScrim','click', closeEditSheet);
/* ドロワー端の ＜ ＞ ：隣の音へ。disabled と行き先（data-id）は src/modes.js の
   renderEdit→syncEditNav が毎回書き直しているので、ここは読むだけでよい。 */
on('editPrev','click', ()=>{
  const b=document.getElementById('editPrev');
  const id=+b.dataset.id;
  if(!isNaN(id) && id>0){ selectEvent(id-1); chirpEvent(ST.events[id-1]); }   /* 次の音を鳴らす（item5） */
});
on('editNext','click', ()=>{
  const b=document.getElementById('editNext');
  const id=+b.dataset.id;
  if(!isNaN(id) && id<ST.events.length-1){ selectEvent(id+1); chirpEvent(ST.events[id+1]); }   /* 次の音を鳴らす（item5） */
});
on('editResetAll','click', ()=>{
  if(!ST.events.length) return;
  if(!confirm(tt('msg.fing_reset_all_confirm'))) return;
  resetFingering();
});

/* ===== 設定（歯車） ===== */
on('viewSeg','click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  ST.view=b.dataset.view;
  syncSettingsUI(); saveSettings(); render();
  if(ST.view==='staff'){
    if(!ST.landscape){ ST.landAuto=true; setLandscape(true); toast(tt('msg.staff_landscape')); }
  } else {
    applyZoom();                                                 /* 指板に戻した直後の枠サイズに合わせて掛け直す */
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
  toast(tt('msg.vol_reset_done', tt('ui.mode_score')));
});
on('countSw','click', ()=>{
  ST.countIn=!ST.countIn;
  document.getElementById('countSw').classList.toggle('on', ST.countIn);
  syncCountSeg();                       /* OFF にしたら 4/8 の選択も触れなくする */
  saveSettings();
});
on('countSeg','click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  ST.countBeats=((+b.dataset.count)===8) ? 8 : 4;
  syncCountSeg();
  saveSettings();
});
/* 軽量モード：軽いMIDI音源に切り替える。再生中は音源が変わるので組み直す */
on('liteSw','click', ()=>{
  ST.lite=!ST.lite;
  document.getElementById('liteSw').classList.toggle('on', ST.lite);
  saveSettings();
  if(ST.playing) startPlay(currentBeat(), true);
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
    if(key==='master'){ const r=document.getElementById('volRowV'); if(r) r.textContent=e.target.value+'%'; }
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

/* ===== コピー練習：子タブ（曲を選ぶ / 譜面を読み込む / MIDIトラック選択） =====
   setScoreSub は songs.js からも呼ぶので drawer.js にある */
on('scoreSubSeg','click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  setScoreSub(b.dataset.sub);
});
on('songBtns','click', e=>{
  /* 共有された曲の行に並ぶボタンを先に見る（曲を開くより優先）。
     削除依頼はお問い合わせフォームへ移したので、ここに残るのは［公開をやめる］だけ。 */
  const un=e.target.closest('[data-unshare]');
  if(un){ unshareSong(un.dataset.unshare); return; }

  const b=e.target.closest('.songbtn'); if(!b || b.disabled) return;
  const id=b.dataset.song;
  if(!id){ toast(tt('msg.soon')); return; }
  /* 'sh:' で始まるものは利用者が共有した曲（api/shares.php から取り出す）。
     それ以外は public/songs/ のあらかじめ用意した曲。 */
  if(id.indexOf('sh:')===0){ loadShared(id.slice(3), false); return; }
  loadSong(id, false);
});
/* 曲一覧の絞り込み。打つたびに並べ直す（通信はしない＝手元の一覧を絞るだけ） */
on('songQ','input', e=> setSongQuery(e.target.value));
/* ❤お気に入り。押すたびに、お気に入りだけ ⇄ 全部 を切り替える */
on('favOnly','click', ()=>{
  const next=!favFilterOn();
  setFavFilter(next);
  syncFavFilterBtn(next);
});
/* 「譜面を読み込む」タブのお気に入り絞り込み。アップ曲一覧をお気に入りだけに切り替える */
on('upFavOnly','click', ()=>{
  const next=!upFavFilterOn();
  setUpFavFilter(next);
  const b=document.getElementById('upFavOnly');
  if(b){ b.classList.toggle('on', next); b.setAttribute('aria-pressed', next?'true':'false'); }
});
/* 指板の左上のハート。いま開いている曲を、お気に入りに入れる／外す。
   曲一覧の右端の印も変わるので、一覧を並べ直す。 */
on('favBtn','click', ()=>{
  const on=toggleFavCurrent();
  if(on===null) return;                 /* 一覧に無い譜面（読み込んだファイル等）は対象外 */
  syncFavBtn();
  renderSongList();
  toast(tt(on ? 'msg.fav_on' : 'msg.fav_off'));
});
/* 指板の左上・ハートの上の「非公開 / 公開中」。
   非公開なら共有の確認画面（#mShare）を出し、公開中なら公開をやめる。 */
on('shareBtn','click', ()=>{
  const it=curUploadItem();
  if(!it) return;
  if(it.shared) unshareSong(it.share_id);
  else openShare(it.id);
});
/* 指板の右上のゴミ箱。いま開いているアップロード済みの譜面を消す
   （確認は deleteUpload の中で出す）。以前は「譜面を読み込む」の一覧にだけあった。 */
on('delBtn','click', ()=>{
  const it=curUploadItem();
  if(it) deleteUpload(it.id);
});
/* 上部バーの曲名。自分がアップロードした譜面のときだけ押せて、その場で名前を変えられる */
on('scoretitle','click', e=>{
  const b=e.currentTarget;
  if(b.disabled || !b.dataset.id) return;
  openRename(b.dataset.id, b.dataset.name || '');
});
/* 曲一覧のページ送り（50件ごと） */
on('songPager','click', e=>{
  const b=e.target.closest('.pgb'); if(!b || b.disabled) return;
  setSongPage(songListPage() + (b.dataset.pg==='next' ? 1 : -1));
});

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
on('loopReset','click', resetLoop);
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

/* ===== 採点ゲーム =====
   課題曲を選ぶ → 開始カウント → メトロノームを聞きながら演奏 → 採点（src/game.js）
   config/app.php の 'game_enabled' が false のあいだは HTML ごと出していないので、
   要素があるときだけ配線する（無いまま on() を呼ぶとコンソールに警告が出るため）。 */
if(document.getElementById('gameSongs')){
  on('gameSongs','click', e=>{
    const b=e.target.closest('.songbtn'); if(!b || b.disabled) return;
    const id=b.dataset.game;
    if(!id){ toast(tt('msg.soon')); return; }
    pickGameSong(id);
  });
  on('gameStart','click', startGame);
  on('gameAbort','click', ()=> abortGame());
  on('gresRetry','click', retryGame);
  /* 録音の準備：入力レベルを見てから始める。やめる／✕ ではマイクも閉じる */
  on('gckGo','click', beginRun);
  on('gckCancel','click', cancelGameCheck);
  on('gckClose','click', cancelGameCheck);
  /* スクリムで閉じたときもマイクを閉じる（closeDockModal の配線はそのまま残す） */
  on('dockScrim','click', cancelGameCheck);
}

/* ===== メトロノーム =====
   つまみを動かしたら設定として保存する。metronome.js から drawer.js を直接呼ぶと
   読み込みの輪ができるので、知らせ（CustomEvent）を受けてここで保存する。 */
window.addEventListener('gs:metrochanged', ()=> saveSettings());

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
/* 歯車：行をタップでサブメニューへ／「‹ 戻る」で一覧へ（iPhoneの設定と同じ動き） */
document.querySelectorAll('[data-gpopen]').forEach(b=> b.addEventListener('click', ()=> openGearPage(b.dataset.gpopen)));
document.querySelectorAll('[data-gpback]').forEach(b=> b.addEventListener('click', ()=> openGearPage('main', true)));

/* ===== 歯車：アカウント（いちばん上）＝ ログイン / 新規登録 / パスワード再発行 / 退会 =====
   画面の切替（signin ⇄ signup ⇄ forgot ⇄ me …）は src/account.js が .acp の on を付け替える。 */
on('svBtn','click', openAccount);
on('acLogin','click',  doLogin);
on('acSignup','click', doSignup);
on('acResend','click', doResend);
on('acForgot','click', doForgot);
on('acPasswd','click', doPasswd);
on('acLogout','click', doLogout);
on('acDestroy','click', doDestroy);
on('acGoogle','click', googleSignin);
on('acGoogleSu','click', googleSignin);
on('acToForgot','click',  showForgot);
on('acToPasswd','click',  showPasswd);
on('acToDestroy','click', showDelete);
/* タブ（ログイン ⇄ 新規登録）とパスワードの目マーク。
   どちらもボタンが複数あるので、#mAcc に一度だけ付けて中で振り分ける。 */
const mAcc = document.getElementById('mAcc');
if (mAcc) mAcc.addEventListener('click', e => {
  const tab = e.target.closest('.actab');
  if (tab) { tab.dataset.actab === 'signup' ? showSignup() : showSignin(); return; }
  const eye = e.target.closest('.pweye');
  if (eye) { togglePassword(eye); return; }
  const back = e.target.closest('[data-acback]');
  if (back) { back.dataset.acback === 'me' ? showMe() : showSignin(); }
});
/* 入力欄で Enter を押したらそのまま送る（フォーム要素を使っていないため自前で拾う） */
on('acEmail','keydown',  e=>{ if(e.key==='Enter') doLogin(); });
on('acPass','keydown',   e=>{ if(e.key==='Enter') doLogin(); });
on('acSuEmail','keydown',e=>{ if(e.key==='Enter') doSignup(); });
on('acSuPass','keydown', e=>{ if(e.key==='Enter') doSignup(); });
on('acFoEmail','keydown',e=>{ if(e.key==='Enter') doForgot(); });
on('acPwNext','keydown', e=>{ if(e.key==='Enter') doPasswd(); });
/* 練習カレンダー（歯車の「累計練習時間」から） */
on('pracBtn','click',  openPractice);
on('pracPrev','click', prevMonth);
on('pracNext','click', nextMonth);
/* 「設定を保存しますか？」のモーダル */
on('acAskYes','click', askLogin);
on('acAskNo','click',  askSkip);

/* ===== 歯車：お問い合わせ（いちばん下） ===== */
on('contactBtn','click', openContact);
on('ctSend','click', sendContact);
/* 種別を「削除依頼」にしたら、曲名と理由の欄を出す */
on('ctKind','change', syncKind);
on('zoom','input', e=> setZoom((+e.target.value||100)/100));
on('zoomIn','click',   ()=> setZoom(ST.zoom*1.25));
on('zoomOut','click',  ()=> setZoom(ST.zoom/1.25));
on('zoomFit','click',  zoomFit);
on('zoomReset','click',()=> setZoom(1));

/* ===== トラック選択（メロディガイド／伴奏／ミュート。試聴はしない） ===== */
on('trackList','click', e=>{
  const rb=e.target.closest('.rbtn');
  if(!rb) return;
  setTrackRole(+rb.dataset.i, rb.dataset.role);
});
/* 伴奏トラックの音色を変える */
on('trackList','change', e=>{
  const sel=e.target.closest('.tinst');
  if(!sel) return;
  setTrackInst(+sel.dataset.i, sel.value);
});
on('skipStart','click', skipToStart);
/* MIDIトラック選択の面から「譜面を読み込む」へ戻る */
on('trackBack','click', ()=> setScoreSub('load'));

/* ===== アップロードした楽譜（保存番号に紐づく一覧） ===== */
/* 名前の変更は上部バーの曲名から、シェアと削除は指板の左上・右上へ移したので、
   ここに残る操作は「トラック」と行そのもの（＝開く）の2つ。 */
on('upList','click', e=>{
  const trk=e.target.closest('.ut');
  if(trk){ openUpload(trk.dataset.id, true); return; } /* 開いてトラック選択の面を出す */
  const row=e.target.closest('.uprow');
  if(row) openUpload(row.dataset.id);
});
/* 名前の変更（#mUpName）と、みんなの曲として公開（#mShare） */
on('upNameGo','click', doRename);
on('upName','keydown', e=>{ if(e.key==='Enter') doRename(); });
on('shGo','click', doShare);

/* ===== 共有曲の管理（歯車の中。管理者にだけ行が出る） ===== */
on('admRow','click', openAdmin);
on('admQ','input', e=> setAdminQuery(e.target.value));
on('admList','click', e=>{
  const b=e.target.closest('[data-adm]'); if(!b) return;
  adminAction(b.dataset.id, b.dataset.adm);
});
on('admPager','click', e=>{
  const b=e.target.closest('.pgb'); if(!b || b.disabled) return;
  setAdminPage(adminListPage() + (b.dataset.admpg==='next' ? 1 : -1));
});
/* 同じ譜面っぽいものがあったとき：上書き / 新規で追加 */
on('upDupOver','click', upDupOverwrite);
on('upDupNew','click',  upDupAddNew);
/* ✕ で閉じたら保存しない（待たせていた内容を捨てる） */
document.querySelectorAll('#mUpDup [data-dkclose]').forEach(b=> b.addEventListener('click', upDupCancel));

/* ===== 運指の保存 =====
   書き出し／読み込み／リセットのUIは廃止した（運指は編集した時点で端末と保存番号の
   両方へ自動保存されるため）。drawer.js に関数は残してあるので、戻すときはここも戻す。 */

/* 初期描画
   スケール定義（public/scales/scales.json）と曲一覧（public/songs/manifest.json）は
   外部読み込みのため、loadSettings() より先に await する
   （scales.json は伴奏の4コード生成 progressionFor() が参照する）。 */
(async ()=>{
  await Promise.all([ loadScales(), loadSongManifest() ]);
  renderGameSongs();                 /* 採点ゲームの課題曲一覧も同じ manifest から作る */
  loadSettings();
  /* 表示言語は URL（/{言語}/{楽器}/）を正とする。保存値で選択欄がずれないように上書き */
  if(window.APP && window.APP.lang) ST.lang=window.APP.lang;
  applyMode();
  syncSettingsUI();
  syncLoopUI();
  render();
  applyZoom();
  /* ログインで設定を降ろしたときに画面を作り直す手順。中身を知っているのは main.js だけなので渡しておく */
  setSaveApply(()=>{
    loadSettings();
    if(window.APP && window.APP.lang) ST.lang=window.APP.lang;
    applyMode();
    syncSettingsUI();
    syncLoopUI();
    render();
    applyZoom();
    /* 降りてきた設定にはお気に入りも入っている。持っている中身を捨てて読み直す */
    reloadFavs();
    syncFavBtn();
    renderSongList();
    /* ログインでサーバの練習記録を突き合わせると累計が増えることがある。
       歯車の「累計練習時間」の1行と（開いていれば）カレンダーも描き直す。
       これをしないと、ドロワーの数字だけ突き合わせ前のまま残り、
       カレンダーの累計とズレて見える。 */
    refreshPracticeLine();
    const pm = document.getElementById('mPractice');
    if (pm && pm.classList.contains('open')) renderCalendar();
  });
  /* ここから先の設定変更だけを自動保存の対象にする（起動時の底上げ保存で尋ねないため） */
  armSave();
  /* アップロードした楽譜の一覧。ログイン状態が決まった時点で account.js から知らせが来る */
  initUploads();
  /* みんなの曲（利用者が共有した楽譜）の一覧。曲一覧に混ぜて出す */
  initShares();
  /* ログイン済みの人には入口（モード選択）を見せず、そのまま「曲を練習する」を開く。
     左ドロワーを開く（＝曲を選ぶ一覧を出す）のは setMode('score') の側（src/modes.js）。
     ログインしているかどうかが決まるのは initAccount() の通信が返ってからなので、
     その知らせ（setSaveWatcher）で1回だけ動かす。
     ・すでに自分でモードを選んでいるときは何もしない（ST.mode を見ている）
     ・ログインしていない人にはこれまでどおり入口を出す */
  let jumpedIn=false;
  setSaveWatcher(who=>{
    if(jumpedIn || !who || ST.mode) return;
    jumpedIn=true;
    setMode('score');
  });
  /* ログイン状態は描画に関係しないので、初期描画の後で取りに行く */
  initAccount();
  /* 練習時間の計測。ST.playing / ST.metroOn を1秒ごとに見るだけなので、他の処理には触らない */
  initPractice();
  initPracticeUI();
  /* メトロノーム。札の組み立てとボタンの配線（設定を読んだあとに呼ぶ） */
  initMetro();

  /* 紹介ページ（/{言語}/{楽器}/?song=<曲id>）からの曲指定。
     「この曲を◯◯で練習する」から来たときは、入口（モード選択）を飛ばして
     『曲を練習する』を開き、その曲をそのまま読み込む。
     ・manifest に無い id は無視（何もしない＝通常どおり入口を出す）
     ・setMode('score') が先に既定サンプルを読むが、直後の loadSong が上書きする
     ・この時点で ST.mode='score' になるので、ログイン者向けの自動ジャンプ
       （上の setSaveWatcher）は空振りし、二重に開かない */
  try{
    const _sid = new URLSearchParams(location.search).get('song');
    if(_sid && SONGS[_sid]){ setMode('score'); loadSong(_sid, false); }
  }catch(e){}
})();
/* ページを離れるときはメトロノームを止める（練習時間が増えたままにならないように） */
window.addEventListener('pagehide', ()=> stopMetro());
window.addEventListener('orientationchange', ()=> setTimeout(applyZoom, 250));
window.addEventListener('resize', centerBoardH);          /* はみ出しぶんは常に中央に置く */
