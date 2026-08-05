/*
  game.js — 採点ゲーム（課題曲を録音して採点する）。

  流れ:
    課題曲を選ぶ（一覧は「曲を練習する」と同じ public/songs/manifest.json）
      → 録音の準備（入力レベルの確認と注意書き）→ 開始カウント
      → メトロノームを聞きながら演奏 → マイクの音からピッチと時刻を取り込む
      → 採点（ピッチ／タイミング／音の数）→ アドバイス・自己ベストとの比較・五線譜で表示

  メトロノームの回り込み対策:
    スピーカーで鳴らすとクリック音をマイクが拾う。次の3つで落とす。
      1. 音域ゲート … 課題曲の音域から外れた高さは捨てる。クリックは 1000Hz(≒B5) で、
                      アクセントの 1600Hz は detectPitch の上限(1200Hz)より上なので元から拾わない。
      2. 長さの下限 … クリックは 45ms 程度しか続かない。短いまとまりは音として数えない。
      3. 一瞬の外れを無視 … 弾いている最中にクリックへ引っ張られても、1サンプルだけなら音を切らない。
    そのうえで、準備画面でイヤホンの使用をすすめている（いちばん確実なため）。

  取り込むのは「その瞬間のピッチと音量」だけで、音声そのものは録らない。
  採点が終わった時点で取り込んだ列（GAME.samples）も捨てるので、演奏は残らない。

  依存: state(ST), util(midiName/tt/INSTRUMENT_ID/pickText),
        songs(SONGS/SHARED/loadSong/levelStars), shares(loadShared),
        drawer(Store/closeDrawer), dom(toast/openDockModal/closeDockModal),
        tuner(detectPitch/FFT_SIZE), audio/synth(metroClick),
        audio/scheduler(showCount/hideCount/acquireWake/releaseWake/stopPlay),
        modes(micUnavailableReason), notation(diatonicIndex/SHARP/clefOf)。
  ※ 五線譜は notation.js の座標計算（diatonicIndex/CLEFS）をそのまま借りて描く。
     採点結果は音符ごとに色を変えるため、renderStaff() とは別のレンダラにしてある
     （notation.js には手を入れない）。
*/
import { ST } from './state.js';
import { midiName, tt, INSTRUMENT_ID, pickText, OPEN } from './util.js';
import { SONGS, SHARED, loadSong, levelStars } from './songs.js';
/* 共有された曲（利用者が公開した楽譜）も課題曲として選べる。中身を取りに行くのは shares.js */
import { loadShared } from './shares.js';
import { Store, closeDrawer } from './drawer.js';
import { toast, openDockModal, closeDockModal } from './dom.js';
import { detectPitch, FFT_SIZE, inputPct, IN_MIN_DB, IN_REC_LO, IN_REC_HI } from './tuner.js';
import { metroClick } from './audio/synth.js';
import { showCount, hideCount, acquireWake, releaseWake, stopPlay } from './audio/scheduler.js';
import { micUnavailableReason } from './modes.js';
import { diatonicIndex, SHARP, clefOf } from './notation.js';

/* ===== 採点のものさし =====
   ピッチ … ±10¢ までは満点。そこから離れるほど下がり、±72¢（半音の7割）で0点。
   タイミング… ±40ms までは満点。±325ms で0点。
   合計 … ピッチ6割・タイミング4割。拾えなかった音は両方0点。
           譜面に無い音（弾き直し・雑音）は1つ1.5点、最大10点まで引く。 */
export const PITCH_OK_CENT   = 10;
export const PITCH_FALL      = 1.6;    /* 1¢ あたりの減点 */
export const TIME_OK_MS      = 40;
export const TIME_FALL       = 0.35;   /* 1ms あたりの減点 */
export const W_PITCH         = 0.6;
export const W_TIME          = 0.4;
export const EXTRA_PENALTY   = 1.5;
export const EXTRA_PENALTY_MAX = 10;
/* ランクの境目（上から順に見て最初に届いたものを使う） */
export const RANKS = [[92,'S'], [84,'A'], [74,'B'], [62,'C'], [48,'D'], [0,'E']];
/* アドバイスに出すズレの下限（これ未満は「よく弾けている」として触れない） */
export const ADV_CENT = 25;
export const ADV_MS   = 180;

/* 解析の間隔（秒）。detectPitch は自己相関で重いので、チューナー（50ms）より細かく、
   かつ端末が追いつく範囲にする。解析窓そのものが 2048/48000≒43ms あるので、
   これ以上細かくしても時間の分解能は上がらない。 */
export const SAMPLE_INTERVAL = 0.022;
/* 音として扱う最低の音量。これを下回るサンプルは「鳴っていない」とみなす */
export const SAMPLE_RMS_MIN = 0.008;
/* 音域ゲート。課題曲の音域からこれだけ外れた高さは「楽器の音ではない」として捨てる。
   メトロノームのクリック（1000Hz≒B5）やスピーカーの残響を音符として拾わないため。
   検出の取り違えで1オクターブずれた場合はゲートに掛かって「拾えず」になるが、
   ゲートが無くても 1200¢ のズレ＝0点なので、点数の上では変わらない。 */
export const RANGE_PAD_UP   = 4;
export const RANGE_PAD_DOWN = 3;

export const GAME = {
  songId:null,          /* 選んでいる課題曲のID */
  phase:'idle',         /* 'idle' | 'check'（録音の準備）| 'run'（録音中） */
  running:false,        /* 録音中（phase==='run'）かどうか */
  midiMin:0, midiMax:127,   /* 音域ゲート（startGame で課題曲から決める） */
  latency:0,            /* メトロノームが実際に聞こえるまでの遅れ（秒） */
  ctx:null, stream:null, analyser:null, buf:null,
  raf:0, timers:[],
  t0:0,                 /* 曲の1拍目の時刻（ctx.currentTime 基準） */
  endT:0,               /* 録音を終える時刻 */
  beatSec:0.75,
  samples:[],           /* [{t, f, rms}] t は曲の頭からの秒数 */
  lastSample:0,
  lastPos:-1,
};

/* ===== 記録（端末のローカル保存） =====
   曲ごとに {best:自己ベスト, last:前回, n:回数}。楽器ごとに分ける（設定・運指と同じ作法）。 */
export function gameKey(id){ return 'cf:'+INSTRUMENT_ID+':game:'+id; }
export function readRec(id){
  try{
    const j=JSON.parse(Store.get(gameKey(id)) || 'null');
    return (j && typeof j==='object') ? j : null;
  }catch(e){ return null; }
}
export function writeRec(id, rec){
  try{ Store.set(gameKey(id), JSON.stringify(rec)); }catch(e){}
}

/* 画面に出す文字はすべてここを通す。共有された曲の名前は利用者が付けたものなので、
   そのまま流し込むと HTML として解釈されてしまう（src/songs.js の esc と同じ作り）。 */
function esc(s){
  return String(s==null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
/* ===== 課題曲の一覧 =====
   「曲を練習する」と同じ SONGS ＋ 共有された曲（SHARED）から作る
   （manifest.json を増やしても、誰かが曲を公開しても、両方の一覧に出る）。
   共有された曲は難易度（level）を持たないので★は出ない。内部IDは 'sh:' を頭に付けて見分ける。 */
export function renderGameSongs(){
  const box=document.getElementById('gameSongs');
  if(!box) return;
  const rows=[];
  Object.keys(SONGS).forEach(id=>{
    const s=SONGS[id];
    rows.push({key:id, title:pickText(s.title)||id, sub:levelStars(s.level)+esc(pickText(s.desc)||'')});
  });
  SHARED.forEach(it=>{
    rows.push({key:'sh:'+it.id, title:esc(it.name||''),
               sub:`<span class="shbadge" title="${esc(tt('share.badge_title'))}">${esc(tt('share.badge'))}</span>${esc(it.sub||'')}`});
  });
  if(!rows.length){ box.innerHTML=tt('msg.no_songs_html'); return; }
  box.innerHTML=rows.map(r=>{
    const rec=readRec(r.key);
    const best = (rec && typeof rec.best==='number')
      ? `<span class="gbest">${tt('ui.game_best_badge', rec.best.toFixed(1))}</span>` : '';
    const on = (r.key===GAME.songId) ? ' on' : '';
    return `<button class="songbtn${on}" data-game="${r.key}">🎮 ${r.title}`
      + `<small>${r.sub}${best}</small></button>`;
  }).join('');
  syncStartBtn();
}
export function syncStartBtn(){
  const b=document.getElementById('gameStart');
  if(b) b.disabled = !(GAME.songId && ST.events.length && GAME.phase==='idle');
}
/* 課題曲を選ぶ。譜面は「曲を練習する」と同じ経路で読み込む（quiet=true でドロワーは開いたまま）。
   'sh:' で始まるものは利用者が共有した曲（api/shares.php から取り出す）。
   自己ベストの記録キーもこの内部IDのままなので、あらかじめ用意した曲と混ざらない。 */
export async function pickGameSong(id){
  if(GAME.phase!=='idle'){ toast(tt('msg.game_busy')); return; }
  const shared = (String(id).indexOf('sh:')===0);
  if(!shared && !SONGS[id]){ toast(tt('msg.soon')); return; }
  GAME.songId=id;
  if(shared) await loadShared(String(id).slice(3), true);
  else       await loadSong(id, true);
  renderGameSongs();
  toast(tt('msg.game_picked', ST.scoreTitle || id));
}

/* ===== 録音（＝ピッチの取り込み） ===== */
/* 曲の終わりの拍。小節が無い譜面でも最後の音までは録る */
export function endBeatOf(){
  let e=0;
  ST.events.forEach(ev=>{ e=Math.max(e, ev.onset+ev.dur); });
  if(ST.measures.length) e=Math.max(e, ST.measures[ST.measures.length-1].end);
  return Math.max(e, 1);
}
/* ===== 出力の遅れ =====
   メトロノームを ctx.currentTime に予約しても、実際にスピーカーやイヤホンから
   聞こえるのは outputLatency ぶん後になる（Bluetooth では 100ms を超えることもある）。
   利用者は「聞こえた時刻」に合わせて弾くので、この分を差し引かないと
   きちんと合わせていても全員がもたっている判定になってしまう。
   outputLatency を持たないブラウザでは baseLatency を、それも無ければ 0 を使う。 */
export const MAX_LATENCY = 0.35;
export function outLatency(ctx){
  const v = (typeof ctx.outputLatency==='number' && ctx.outputLatency>0) ? ctx.outputLatency
          : (typeof ctx.baseLatency==='number' ? ctx.baseLatency : 0);
  return Math.min(MAX_LATENCY, Math.max(0, v || 0));
}

/* 課題曲の音域。この外の高さは楽器の音ではないとみなす（メトロノーム対策） */
export function midiRangeOf(){
  let lo=Infinity, hi=-Infinity;
  ST.events.forEach(ev=>{
    const m=ev.pitches[ev.leadIdx].midi;
    if(m<lo) lo=m;
    if(m>hi) hi=m;
  });
  if(!isFinite(lo)) return {lo:0, hi:127};
  return {lo:Math.max(OPEN[0]-2, lo-RANGE_PAD_DOWN), hi:hi+RANGE_PAD_UP};
}

/* ===== 録音の準備 =====
   いきなり録り始めず、先にマイクを開いて入力レベルと聞こえている音を見せる。
   ここで許可も取ってしまうので、「開始する」を押してからカウントまでの間に
   許可ダイアログが割り込むことがない。 */
export async function startGame(){
  if(GAME.phase!=='idle') return;
  if(!GAME.songId || !ST.events.length){ toast(tt('msg.game_need_song')); return; }

  const reason=micUnavailableReason();
  if(reason){ toast(tt('msg.mic_unavailable')); return; }

  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}
    });
  }catch(e){ toast(tt('msg.mic_start_fail', e.message)); return; }

  stopPlay();                         /* 通常の再生が動いていれば止める */
  closeDrawer();

  const AC=window.AudioContext||window.webkitAudioContext;
  const ctx=new AC();
  if(ctx.state==='suspended'){ try{ await ctx.resume(); }catch(e){} }
  const src=ctx.createMediaStreamSource(stream);
  const an=ctx.createAnalyser(); an.fftSize=FFT_SIZE;
  src.connect(an);

  const r=midiRangeOf();
  GAME.phase='check'; GAME.running=false;
  GAME.ctx=ctx; GAME.stream=stream; GAME.analyser=an;
  GAME.buf=new Float32Array(an.fftSize);
  GAME.timers=[]; GAME.samples=[]; GAME.lastSample=0; GAME.lastPos=-1;
  GAME.midiMin=r.lo; GAME.midiMax=r.hi;

  syncStartBtn();
  updateCheck(0, 0, -1);
  openDockModal('mGameReady');
  checkLoop();
}
/* 準備画面のあいだ回すループ。入力レベルと、いま聞こえている音を出す */
export function checkLoop(){
  if(GAME.phase!=='check') return;
  GAME.raf=requestAnimationFrame(checkLoop);
  const ctx=GAME.ctx;
  if(!ctx) return;
  const now=ctx.currentTime;
  if(now - GAME.lastSample < 0.05) return;     /* 約20fps（チューナーと同じ） */
  GAME.lastSample=now;

  GAME.analyser.getFloatTimeDomainData(GAME.buf);
  let sq=0, pk=0;
  for(let i=0;i<GAME.buf.length;i++){
    const v=GAME.buf[i];
    sq+=v*v;
    const a=(v<0)?-v:v;
    if(a>pk) pk=a;
  }
  const rms=Math.sqrt(sq/GAME.buf.length);
  const f=(rms>=SAMPLE_RMS_MIN) ? detectPitch(GAME.buf, ctx.sampleRate) : -1;
  updateCheck(rms, pk, f);
}
/* 入力レベルのバーと文言（チューナーの見た目・区間をそのまま使う） */
export function updateCheck(rms, peak, f){
  const bar=document.getElementById('gckLevel');
  const msg=document.getElementById('gckMsg');
  if(bar && msg){
    const db=20*Math.log10(Math.max(rms, 1e-6));
    const hot=(peak>=0.98) || (db>IN_REC_HI);
    const ok =!hot && (db>=IN_REC_LO);
    bar.style.clipPath='inset(0 '+(100-inputPct(db)).toFixed(1)+'% 0 0)';
    msg.textContent = hot ? tt('msg.lvl_too_loud')
                    : ok  ? 'OK'
                    : (db < IN_MIN_DB+8) ? tt('msg.lvl_too_quiet') : tt('msg.lvl_louder');
    msg.className = hot ? 'hot' : (ok ? 'ok' : 'low');
  }
  /* 「聞こえている音」のピッチ表示は廃止した。
     この画面で知りたいのはマイクの音量が適正かどうかで、音名は判断材料にならないため
     （音名を見たいときはチューナーモードを使う）。
     引数 f（検出した周波数）は checkLoop からそのまま渡ってくるが、ここでは使わない。 */
}
/* 準備をやめる（マイクを閉じて元へ戻す） */
export function cancelGameCheck(){
  if(GAME.phase!=='check') return;
  closeDockModal();
  stopGameAudio();
}
/* 「開始する」＝ここから本番。マイクは準備画面で開いたものをそのまま使う */
export function beginRun(){
  if(GAME.phase!=='check') return;
  const ctx=GAME.ctx;
  if(!ctx){ stopGameAudio(); return; }
  closeDockModal();

  /* メトロノームの出力。マイク用の ctx をそのまま使う（別の ctx にすると時計がずれる） */
  const out=ctx.createGain();
  const vol=ST.vol || {};
  out.gain.value=Math.max(0, Math.min(1, (vol.metro!=null?vol.metro:0.6) * (vol.master!=null?vol.master:0.8)));
  out.connect(ctx.destination);

  const bs=60/ST.tempo;
  const unit=(ST.beatUnit>0) ? ST.beatUnit : 1;
  const countN=(ST.countBeats===8) ? 8 : 4;
  const countSec=bs*unit;
  const lead=0.30;
  const t0=ctx.currentTime + lead + countN*countSec;
  const endBeat=endBeatOf();

  GAME.phase='run'; GAME.running=true;
  GAME.timers=[]; GAME.samples=[]; GAME.lastSample=0; GAME.lastPos=-1;
  GAME.t0=t0; GAME.beatSec=bs;
  GAME.latency=outLatency(ctx);       /* 聞こえた時刻に合わせるための補正 */
  GAME.endT=t0 + endBeat*bs + GAME.latency + 0.7;   /* 最後の音の余韻ぶんだけ長めに録る */

  /* 開始カウント（画面いっぱいの数字＋クリック）。ゲームは合図が要るので常に出す */
  for(let i=0;i<countN;i++){
    const at=ctx.currentTime + lead + i*countSec;
    metroClick(ctx, out, at, i===0);
    GAME.timers.push(setTimeout(()=> showCount(i+1), Math.max(0,(at-ctx.currentTime)*1000)));
  }
  GAME.timers.push(setTimeout(hideCount, Math.max(0,(lead + countN*countSec - 0.05)*1000)));

  /* 本編のメトロノーム。小節の頭だけアクセントを付ける */
  const beats=ST.beatsPerMeasure || 4;
  const total=Math.min(2000, Math.floor(endBeat/unit + 1e-6));
  for(let i=0;i<total;i++){
    const b=i*unit;
    metroClick(ctx, out, t0 + b*bs, Math.abs(b % beats) < 1e-6);
  }

  showRecBar(true);
  syncStartBtn();
  acquireWake();
  if(GAME.raf){ cancelAnimationFrame(GAME.raf); GAME.raf=0; }
  gameLoop();
}
export function gameLoop(){
  if(!GAME.running) return;
  GAME.raf=requestAnimationFrame(gameLoop);
  const ctx=GAME.ctx;
  if(!ctx) return;
  const now=ctx.currentTime;
  updateRecBar(now);
  if(now >= GAME.endT){ finishGame(); return; }
  if(now - GAME.lastSample < SAMPLE_INTERVAL) return;
  GAME.lastSample=now;

  GAME.analyser.getFloatTimeDomainData(GAME.buf);
  let sq=0;
  for(let i=0;i<GAME.buf.length;i++){ const v=GAME.buf[i]; sq+=v*v; }
  const rms=Math.sqrt(sq/GAME.buf.length);
  let f=(rms>=SAMPLE_RMS_MIN) ? detectPitch(GAME.buf, ctx.sampleRate) : -1;
  if(f>0){
    /* 課題曲の音域から外れた高さは捨てる。メトロノームのクリック（1000Hz≒B5）や
       スピーカーの残響を音符として数えないため。 */
    const midi=69 + 12*Math.log2(f/440);
    if(midi < GAME.midiMin || midi > GAME.midiMax) f=-1;
  }
  /* 解析窓は「少し前の音」を見ている。窓の真ん中の時刻に合わせ、
     さらにメトロノームが実際に聞こえるまでの遅れ（GAME.latency）を差し引く */
  const t=now - GAME.t0 - GAME.latency - (GAME.buf.length/ctx.sampleRate)/2;
  if(t > -0.15) GAME.samples.push({t, f, rms});
}
/* 録音中の帯（いま何小節目か・中止ボタン） */
export function showRecBar(on){
  const el=document.getElementById('gameRec');
  if(el) el.classList.toggle('show', !!on);
}
export function updateRecBar(now){
  const el=document.getElementById('gameRecPos');
  if(!el) return;
  const beats=ST.beatsPerMeasure || 4;
  const b=(now - GAME.t0)/GAME.beatSec;
  const pos=(b<0) ? 0 : Math.floor(b/beats)+1;
  if(pos===GAME.lastPos) return;
  GAME.lastPos=pos;
  el.textContent = (pos<=0) ? tt('ui.game_ready') : tt('ui.game_measure', pos);
}
/* マイクと音を片づける（採点するかどうかに関わらず通る） */
export function stopGameAudio(){
  if(GAME.raf){ cancelAnimationFrame(GAME.raf); GAME.raf=0; }
  GAME.timers.forEach(t=>clearTimeout(t)); GAME.timers=[];
  if(GAME.stream){ GAME.stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(e){} }); }
  if(GAME.ctx){ try{ GAME.ctx.close(); }catch(e){} }
  GAME.ctx=null; GAME.stream=null; GAME.analyser=null; GAME.buf=null;
  GAME.running=false; GAME.phase='idle'; GAME.lastPos=-1;
  hideCount();
  showRecBar(false);
  releaseWake(true);
  syncStartBtn();
}
/* 途中でやめる（採点しない＝取り込んだ列もそのまま捨てる） */
export function abortGame(quiet){
  if(GAME.phase==='idle') return;
  closeDockModal();               /* 準備画面を開いたままモードを抜けた場合 */
  stopGameAudio();
  GAME.samples=[];
  if(!quiet) toast(tt('msg.game_aborted'));
}
export function finishGame(){
  const samples=GAME.samples;
  stopGameAudio();
  let res=null;
  try{ res=scoreRun(samples); }
  catch(e){ GAME.samples=[]; toast(tt('msg.game_failed', e.message)); return; }
  /* 取り込んだ音の記録はここで捨てる（点数と結果表示だけを残す） */
  GAME.samples=[];
  showResult(res);
}

/* ===== 取り込んだ列 → 弾いた音の並び ===== */
export function median(a){
  if(!a.length) return 0;
  const s=[...a].sort((x,y)=>x-y);
  const h=s.length>>1;
  return (s.length%2) ? s[h] : (s[h-1]+s[h])/2;
}
/* 続いている同じ高さのまとまりを1つの音にする。
   ・高さが 0.7 半音より動いたら別の音
   ・無音が3サンプル続いたら区切る
   ・短すぎるまとまり（雑音・弓の擦れ）は捨てる */
export function segmentNotes(samples, beatSec){
  const minDur=Math.min(0.14, Math.max(0.06, beatSec*0.30));
  const out=[];
  let cur=null;
  const flush=()=>{
    if(!cur) return;
    const dur=cur.t1-cur.t0;
    if(dur>=minDur && cur.list.length>=3){
      const m=median(cur.list);
      out.push({t0:cur.t0, t1:cur.t1, midif:m, midi:Math.round(m), cents:Math.round((m-Math.round(m))*100)});
    }
    cur=null;
  };
  /* 高さが外れたサンプルは、すぐには新しい音にしない。
     2つ続いて初めて「別の音になった」と判断する。メトロノームのクリックに
     一瞬だけ引っ張られても、伸ばしている音を途中で切らないため。 */
  let pend=[];
  for(const s of samples){
    if(!(s.f>0) || s.rms<SAMPLE_RMS_MIN){
      pend=[];
      if(cur){ cur.gap++; if(cur.gap>=3) flush(); }
      continue;
    }
    const midi=69 + 12*Math.log2(s.f/440);
    if(cur && Math.abs(midi - cur.ref) < 0.7){
      pend=[];                       /* 外れは一瞬だった＝雑音として無かったことにする */
      cur.list.push(midi); cur.t1=s.t; cur.gap=0;
      cur.ref=median(cur.list.slice(-9));
    }else if(cur){
      pend.push({t:s.t, midi});
      /* 続けて外れた＝本当に別の音。溜めていたぶんを頭にして次の音を始める */
      if(pend.length>=2 && Math.abs(pend[1].midi - pend[0].midi) < 0.7){
        flush();
        cur={t0:pend[0].t, t1:pend[1].t, list:pend.map(x=>x.midi), ref:median(pend.map(x=>x.midi)), gap:0};
        pend=[];
      }else if(pend.length>=2){
        pend=[pend[pend.length-1]];  /* ばらばらに外れている＝雑音。最後の1つだけ残す */
      }
    }else{
      cur={t0:s.t, t1:s.t, list:[midi], ref:midi, gap:0};
      pend=[];
    }
  }
  flush();
  return out;
}
/* 譜面の音（expected）と弾いた音（played）を順番を崩さずに対応づける。
   どちらにも抜け・余りがあるので、編集距離と同じ組み方（DP）で通す。 */
export const GAP_COST = 0.85;
export function matchCost(e, p){
  const cent=Math.abs((p.midif - e.midi)*100);
  const dt=Math.abs(p.t0 - e.t);
  return 0.6*Math.min(1, cent/120) + 0.4*Math.min(1, dt/0.6);
}
export function alignNotes(expected, played){
  const n=expected.length, m=played.length;
  const D=[], B=[];
  for(let i=0;i<=n;i++){ D.push(new Float64Array(m+1)); B.push(new Int8Array(m+1)); }
  for(let i=1;i<=n;i++){ D[i][0]=D[i-1][0]+GAP_COST; B[i][0]=1; }
  for(let j=1;j<=m;j++){ D[0][j]=D[0][j-1]+GAP_COST; B[0][j]=2; }
  for(let i=1;i<=n;i++){
    for(let j=1;j<=m;j++){
      const a=D[i-1][j-1] + matchCost(expected[i-1], played[j-1]);
      const b=D[i-1][j] + GAP_COST;
      const c=D[i][j-1] + GAP_COST;
      let v=a, k=0;
      if(b<v){ v=b; k=1; }
      if(c<v){ v=c; k=2; }
      D[i][j]=v; B[i][j]=k;
    }
  }
  const pair=new Array(n).fill(-1);
  let i=n, j=m, extra=0;
  while(i>0 || j>0){
    if(i>0 && j>0 && B[i][j]===0){ pair[i-1]=j-1; i--; j--; }
    else if(i>0 && (j===0 || B[i][j]===1)){ i--; }
    else { extra++; j--; }
  }
  return {pair, extra};
}

/* ===== 採点 ===== */
export function clamp100(v){ return Math.max(0, Math.min(100, v)); }
export function pitchPoints(cents){ return clamp100(100 - Math.max(0, Math.abs(cents)-PITCH_OK_CENT)*PITCH_FALL); }
export function timePoints(ms){    return clamp100(100 - Math.max(0, Math.abs(ms)-TIME_OK_MS)*TIME_FALL); }
export function rankOf(total){
  for(const [th, r] of RANKS){ if(total>=th) return r; }
  return 'E';
}
/* 次のランクまであと何点か。Sなら null */
export function nextRank(total){
  for(let i=RANKS.length-1;i>=0;i--){
    if(RANKS[i][0] > total) return {rank:RANKS[i][1], need:Math.round((RANKS[i][0]-total)*10)/10};
  }
  return null;
}
export function scoreRun(samples){
  const bs=GAME.beatSec || (60/ST.tempo);
  const played=segmentNotes(samples, bs);
  const expected=ST.events.map(ev=>({
    id:ev.id, measure:ev.measure, midi:ev.pitches[ev.leadIdx].midi, t:ev.onset*bs
  }));
  if(!expected.length) throw new Error(tt('msg.game_no_notes'));

  const {pair, extra}=alignNotes(expected, played);
  const notes=expected.map((e,i)=>{
    const p=(pair[i]>=0) ? played[pair[i]] : null;
    if(!p) return {measure:e.measure, midi:e.midi, hit:false, cents:0, dt:0, pitch:0, time:0};
    const cents=Math.round((p.midif - e.midi)*100);
    const dt=Math.round((p.t0 - e.t)*1000);
    return {measure:e.measure, midi:e.midi, hit:true, cents, dt,
            pitch:pitchPoints(cents), time:timePoints(dt)};
  });

  const n=notes.length;
  const hits=notes.filter(x=>x.hit);
  const pitch=notes.reduce((a,x)=>a+x.pitch,0)/n;
  const timing=notes.reduce((a,x)=>a+x.time,0)/n;
  const penalty=Math.min(EXTRA_PENALTY_MAX, extra*EXTRA_PENALTY);
  const total=Math.round(clamp100(pitch*W_PITCH + timing*W_TIME - penalty)*10)/10;

  return {
    songId:GAME.songId, total, rank:rankOf(total),
    pitch:Math.round(pitch*10)/10, timing:Math.round(timing*10)/10,
    hit:hits.length, count:n, extra, penalty:Math.round(penalty*10)/10,
    meanDt: hits.length ? Math.round(hits.reduce((a,x)=>a+x.dt,0)/hits.length) : 0,
    notes
  };
}

/* ===== アドバイス =====
   「〇小節目の〇がピッチおかしい」のように、直せる場所を名指しで出す。 */
export function buildAdvice(res){
  const out=[];
  /* ピッチのズレが大きい音（上位2つまで） */
  const bad=res.notes.filter(x=>x.hit && Math.abs(x.cents)>=ADV_CENT)
                     .sort((a,b)=>Math.abs(b.cents)-Math.abs(a.cents)).slice(0,2);
  bad.forEach(x=>{
    out.push(tt(x.cents>0 ? 'msg.game_adv_sharp' : 'msg.game_adv_flat',
                x.measure, midiName(x.midi), Math.abs(x.cents)));
  });
  /* 拾えなかった音 */
  const miss=res.notes.filter(x=>!x.hit);
  if(miss.length){
    out.push(miss.length>1
      ? tt('msg.game_adv_miss_n', miss[0].measure, midiName(miss[0].midi), miss.length)
      : tt('msg.game_adv_miss',   miss[0].measure, midiName(miss[0].midi)));
  }
  /* 入りが大きくずれた音（いちばん大きいもの1つ） */
  const late=res.notes.filter(x=>x.hit && Math.abs(x.dt)>=ADV_MS)
                      .sort((a,b)=>Math.abs(b.dt)-Math.abs(a.dt))[0];
  if(late){
    out.push(tt(late.dt>0 ? 'msg.game_adv_late' : 'msg.game_adv_early',
                late.measure, midiName(late.midi), Math.abs(late.dt)));
  }
  /* 走り／もたり */
  if(Math.abs(res.meanDt) >= ADV_MS/2){
    out.push(tt(res.meanDt<0 ? 'msg.game_adv_rush' : 'msg.game_adv_drag', Math.abs(res.meanDt)));
  }
  /* 譜面に無い音（弾き直し・雑音） */
  if(res.extra>0) out.push(tt('msg.game_adv_extra', res.extra));
  if(!out.length) out.push(tt('msg.game_adv_good'));
  return out.slice(0,4);
}
/* 自己ベスト・前回との比較。読んだ後に今回の記録を書き込む */
export function compareAndSave(res){
  const rec=readRec(res.songId) || {};
  const hasBest=(typeof rec.best==='number');
  const hasLast=(typeof rec.last==='number');
  const lines=[];
  if(!hasBest){
    lines.push(tt('msg.game_first'));
  }else if(res.total > rec.best){
    lines.push(tt('msg.game_best_new', (res.total-rec.best).toFixed(1)));
  }else if(hasLast && res.total >= rec.last+0.5){
    lines.push(tt('msg.game_better', (res.total-rec.last).toFixed(1)));
  }else if(hasLast && res.total <= rec.last-0.5){
    lines.push(tt('msg.game_worse', (rec.last-res.total).toFixed(1)));
  }else{
    lines.push(tt('msg.game_same'));
  }
  if(hasBest) lines.push(tt('msg.game_best_is', Math.max(rec.best, res.total).toFixed(1)));
  const nx=nextRank(res.total);
  if(nx) lines.push(tt('msg.game_next_rank', nx.need.toFixed(1), nx.rank));

  writeRec(res.songId, {
    best: hasBest ? Math.max(rec.best, res.total) : res.total,
    last: res.total,
    n: (typeof rec.n==='number' ? rec.n : 0) + 1
  });
  return lines;
}

/* ===== 結果の五線譜 =====
   notation.js と同じ座標の決め方で描き、音符の色だけ採点結果で変える。
     緑＝OK ／ 赤＝ピッチが外れている ／ 青＝タイミングが外れている ／ 灰＝拾えなかった */
export function noteColor(x){
  if(!x.hit) return 'var(--faint)';
  if(Math.abs(x.cents) >= ADV_CENT) return 'var(--danger)';
  if(Math.abs(x.dt)    >= ADV_MS)   return 'var(--alt)';
  return 'var(--good)';
}
export function buildResultStaff(res){
  const box=document.getElementById('gresStaff');
  if(!box) return;
  const notes=res.notes;
  if(!notes.length){ box.innerHTML=''; return; }

  const mids=notes.map(x=>x.midi).sort((a,b)=>a-b);
  const CLEF=clefOf(mids[Math.floor(mids.length/2)]);
  const H=150, TOP=54, SPACE=8;
  const baseIdx=diatonicIndex(CLEF.base);
  const lineY = i => (TOP + 4*SPACE) - (i - baseIdx)*(SPACE/2);
  const NW=30, LEFT=48;
  const W=LEFT + notes.length*NW + 24;

  const p=[];
  p.push(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`);
  for(let i=0;i<5;i++){
    const y=TOP+i*SPACE;
    p.push(`<line x1="6" y1="${y}" x2="${W-6}" y2="${y}" stroke="var(--muted)" stroke-width="1" opacity="0.55"/>`);
  }
  p.push(`<text x="10" y="${TOP+4*SPACE+CLEF.dy}" font-size="${CLEF.size}" fill="var(--ink)">${CLEF.glyph}</text>`);

  let curM=-1;
  notes.forEach((x,i)=>{
    const cx=LEFT+i*NW+NW/2;
    if(x.measure!==curM){
      curM=x.measure;
      if(i>0) p.push(`<line x1="${cx-NW/2-4}" y1="${TOP}" x2="${cx-NW/2-4}" y2="${TOP+4*SPACE}" stroke="var(--line)" stroke-width="1.5"/>`);
      p.push(`<text x="${cx-NW/2-2}" y="${TOP-10}" font-size="9" fill="var(--faint)" font-family="var(--mono)">${curM}</text>`);
    }
    const y=lineY(diatonicIndex(x.midi));
    const col=noteColor(x);
    const topLine=TOP, botLine=TOP+4*SPACE;
    for(let yy=botLine+SPACE; yy<=y+0.1; yy+=SPACE) p.push(`<line x1="${cx-8}" y1="${yy}" x2="${cx+8}" y2="${yy}" stroke="var(--muted)" stroke-width="1" opacity="0.5"/>`);
    for(let yy=topLine-SPACE; yy>=y-0.1; yy-=SPACE) p.push(`<line x1="${cx-8}" y1="${yy}" x2="${cx+8}" y2="${yy}" stroke="var(--muted)" stroke-width="1" opacity="0.5"/>`);
    if(SHARP[((x.midi%12)+12)%12]) p.push(`<text x="${cx-15}" y="${y+4}" font-size="12" fill="${col}">♯</text>`);
    p.push(`<ellipse cx="${cx}" cy="${y}" rx="5.2" ry="4" fill="${col}" transform="rotate(-18 ${cx} ${y})"/>`);
    const up=y > TOP+2*SPACE;
    p.push(`<line x1="${up?cx+5:cx-5}" y1="${y}" x2="${up?cx+5:cx-5}" y2="${up?y-24:y+24}" stroke="${col}" stroke-width="1.3"/>`);
    /* ズレの大きい音だけ数字を添える（何¢ 外れているか） */
    if(x.hit && Math.abs(x.cents)>=ADV_CENT){
      p.push(`<text x="${cx}" y="${H-8}" font-size="9" text-anchor="middle" fill="var(--danger)" font-family="var(--mono)">${x.cents>0?'+':''}${x.cents}</text>`);
    }else if(!x.hit){
      p.push(`<text x="${cx}" y="${H-8}" font-size="9" text-anchor="middle" fill="var(--faint)" font-family="var(--mono)">–</text>`);
    }
  });
  p.push('</svg>');
  box.innerHTML=`<div class="gres-stfwrap">${p.join('')}</div>`;
}

/* ===== 結果を出す ===== */
export function showResult(res){
  const cmp=compareAndSave(res);
  const adv=buildAdvice(res);

  const rk=document.getElementById('gresRank');
  if(rk){ rk.textContent=res.rank; rk.dataset.rank=res.rank; }
  const sc=document.getElementById('gresScore');
  if(sc) sc.textContent=res.total.toFixed(1);

  const cm=document.getElementById('gresCmp');
  if(cm) cm.innerHTML=cmp.map(x=>`<div>${x}</div>`).join('');

  const bk=document.getElementById('gresBreak');
  if(bk){
    bk.innerHTML=
        `<div><span>${tt('ui.game_b_pitch')}</span><b>${res.pitch.toFixed(1)}</b></div>`
      + `<div><span>${tt('ui.game_b_time')}</span><b>${res.timing.toFixed(1)}</b></div>`
      + `<div><span>${tt('ui.game_b_hit')}</span><b>${res.hit}/${res.count}</b></div>`;
  }

  const ad=document.getElementById('gresAdvice');
  if(ad) ad.innerHTML=adv.map(x=>`<li>${x}</li>`).join('');

  buildResultStaff(res);
  renderGameSongs();
  openDockModal('mGameRes');
}
/* 結果モーダルの「もう一度」 */
export function retryGame(){
  closeDockModal();
  setTimeout(()=> startGame(), 120);   /* もう一度：入力レベルの確認からやり直す */
}
