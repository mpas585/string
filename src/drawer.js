/*
  drawer.js — ストレージ・設定の保存/復元・運指の保存/読込・ドロワー/ギアの開閉・子タブ切替。
  元 cello-finger.html より無改変で移植。
    Store（localStorage / 不可環境はメモリ）      … L1870–1882
    SETTINGS_KEY/saveSettings/loadSettings/syncSettingsUI … L1883–1944
    scoreSig/fingerData/applyFingerData          … L1945–1975
    saveTimer/saveFingering/loadFingering         … L1976–1987
    exportFingering/importFingering/resetFingering … L1988–2013
    openDrawer/openGear/closeGear/toggleGear/closeDrawer … L3491–3497
  依存: state(ST/volProfileKey), util(fracOf/zoneOf/fingerHint), fingerboard(recommend),
        modes(render/syncLayoutClass), dom(toast)。
  ※ PDFの参照表示・読み取り（OMR）は廃止した（openPdfOverlay / closePdfOverlay も削除）。
*/
import { ST, volProfileKey, VOL_KEYS } from './state.js';
import { fracOf, zoneOf, fingerHint, INSTRUMENT_ID, tt } from './util.js';
import { recommend } from './fingerboard.js';
import { SCALES } from './scale.js';
import { render, syncLayoutClass, syncDock } from './modes.js';
import { toast, clearPlayAttn } from './dom.js';
/* 保存（保存番号）への通知。設定と運指の保存はここが唯一の出口なので、ここから知らせる */
import { settingsChanged } from './account.js';

export const Store = (()=>{
  let ok=false;
  try{ localStorage.setItem('__cf_t','1'); localStorage.removeItem('__cf_t'); ok=true; }catch(e){ ok=false; }
  const mem={};
  return {
    ok,
    get(k){ try{ return ok ? localStorage.getItem(k) : (k in mem ? mem[k] : null); }catch(e){ return (k in mem ? mem[k] : null); } },
    set(k,v){ try{ if(ok) localStorage.setItem(k,v); else mem[k]=v; }catch(e){ mem[k]=v; } },
    del(k){ try{ if(ok) localStorage.removeItem(k); else delete mem[k]; }catch(e){ delete mem[k]; } }
  };
})();

/* ===== 設定の保存（localStorage。使えない環境ではメモリ） ===== */
/* 保存キーは楽器ごとに分ける（チェロとバイオリンで設定・運指が混ざらないように）。
   楽器別にする前のキーは 'cf:…' で、チェロ専用だった。読み込みのときだけ互換で見る。 */
const KEY_PREFIX='cf:'+INSTRUMENT_ID+':';
const LEGACY_PREFIX='cf:';
const LEGACY_INSTRUMENT='cello';
function legacyGet(key){ return (INSTRUMENT_ID===LEGACY_INSTRUMENT) ? Store.get(key) : null; }

export const SETTINGS_KEY=KEY_PREFIX+'settings:v1';
const LEGACY_SETTINGS_KEY=LEGACY_PREFIX+'settings:v1';
/* 保存済みの音量プロファイルにも「全トラック +5」を1回だけ反映するための版番号 */
export const VOL_BUMP=1;
export function saveSettings(){
  Store.set(SETTINGS_KEY, JSON.stringify({
    view:ST.view, frets:ST.frets, landscape:ST.landscape, zoom:ST.zoom, octave:ST.octave, pref:ST.pref,
    volProfiles:ST.volProfiles, volBump:VOL_BUMP, countIn:ST.countIn, countBeats:ST.countBeats, keepAwake:ST.keepAwake,
    lite:ST.lite,
    tempo:ST.tempo, enjoy:ST.enjoy, loop:ST.loop, lang:ST.lang,
    keyRoot:ST.keyRoot, scaleType:ST.scaleType, scaleOct:ST.scaleOct
  }));
  settingsChanged();          /* 保存番号があればサーバへも上書き。無ければ作成を尋ねる */
}
export function loadSettings(){
  const raw=Store.get(SETTINGS_KEY) || legacyGet(LEGACY_SETTINGS_KEY); if(!raw) return;
  let bumped=false;
  try{
    const j=JSON.parse(raw);
    if(j.view==='board'||j.view==='staff') ST.view=j.view;
    if(typeof j.frets==='boolean') ST.frets=j.frets;
    if(typeof j.landscape==='boolean') ST.landscape=j.landscape;
    if(typeof j.zoom==='number') ST.zoom=j.zoom;
    if(j.octave!=null) ST.octave=j.octave;
    if(j.pref) ST.pref=j.pref;
    if(j.volProfiles){
      if(j.volProfiles.scale) Object.assign(ST.volProfiles.scale, j.volProfiles.scale);
      if(j.volProfiles.score) Object.assign(ST.volProfiles.score, j.volProfiles.score);
      /* 保存済みの音量にも「全トラック +5」を1回だけ反映する（初期値だけ上げても既存端末に効かないため） */
      if(j.volBump!==VOL_BUMP){
        for(const pk of ['scale','score']){
          for(const k of VOL_KEYS) ST.volProfiles[pk][k]=Math.min(1, (ST.volProfiles[pk][k]||0)+0.05);
        }
        bumped=true;
      }
    }
    if(typeof j.countIn==='boolean') ST.countIn=j.countIn;
    if(j.countBeats===4 || j.countBeats===8) ST.countBeats=j.countBeats;
    if(typeof j.keepAwake==='boolean') ST.keepAwake=j.keepAwake;
    if(typeof j.lite==='boolean') ST.lite=j.lite;
    if(typeof j.tempo==='number') ST.tempo=j.tempo;
    if(typeof j.enjoy==='boolean') ST.enjoy=j.enjoy;
    if(j.loop) Object.assign(ST.loop, j.loop);
    if(j.lang) ST.lang=j.lang;
    if(typeof j.keyRoot==='number') ST.keyRoot=j.keyRoot;
    if(j.scaleType && SCALES[j.scaleType]) ST.scaleType=j.scaleType;
    if(typeof j.scaleOct==='number') ST.scaleOct=j.scaleOct;
  }catch(e){}
  if(bumped) saveSettings();          /* 底上げは1回だけ。以降は volBump 済みとして保存 */
}
/* 設定UIを状態に合わせる */
export function syncSettingsUI(){
  document.querySelectorAll('#viewSeg button').forEach(b=> b.classList.toggle('on', b.dataset.view===ST.view));
  document.body.classList.toggle('view-staff', ST.view==='staff');
  /* 歯車の一覧に出す「表示」の要約 */
  const vrow=document.getElementById('viewRowV');
  if(vrow) vrow.textContent=tt(ST.view==='staff' ? 'ui.view_staff' : 'ui.view_board');
  /* 指板ズームは「指板」を選んでいるときだけ出す（五線譜では効かないため） */
  const zbox=document.getElementById('zoomBox');
  if(zbox) zbox.hidden=(ST.view!=='board');
  document.getElementById('fretSw').classList.toggle('on', ST.frets);
  document.getElementById('landSw').classList.toggle('on', ST.landscape);
  document.body.classList.toggle('force-landscape', ST.landscape);
  syncLayoutClass();
  document.querySelectorAll('.pref').forEach(b=> b.classList.toggle('on', b.dataset.pref===ST.pref));
  document.querySelectorAll('.oct').forEach(b=> b.classList.toggle('on', String(b.dataset.oct)===String(ST.octave)));
  document.getElementById('enjoySw').classList.toggle('on', ST.enjoy);
  document.getElementById('tempo').value=ST.tempo;
  const tnum=document.getElementById('tempoNum');
  if(tnum) tnum.value=ST.tempo;
  document.getElementById('countSw').classList.toggle('on', ST.countIn);
  syncCountSeg();
  document.getElementById('awakeSw').classList.toggle('on', ST.keepAwake);
  const liteEl=document.getElementById('liteSw');
  if(liteEl) liteEl.classList.toggle('on', ST.lite);
  const langEl=document.getElementById('langSel');
  if(langEl) langEl.value=ST.lang;
  syncLangRow();
  ST.vol = ST.volProfiles[volProfileKey()];
  for(const k of VOL_KEYS){
    const id='vol'+k[0].toUpperCase()+k.slice(1);
    const el=document.getElementById(id), lb=document.getElementById(id+'V');
    const v=Math.round(ST.vol[k]*100);
    if(el) el.value=v;
    if(lb) lb.textContent=v;
  }
  syncVolRow();
  syncDock();
}
/* 開始カウント（4 / 8）。「開始カウント」がOFFのあいだは選べないようにする
   （押しても何も起きない入力を残さない＝ループ小節の disabled と同じ考え方） */
export function syncCountSeg(){
  /* 歯車の一覧に出す要約（OFF / 4カウント / 8カウント）。サブメニューを開かなくても分かるように */
  const row=document.getElementById('countRowV');
  if(row) row.textContent = ST.countIn ? tt(ST.countBeats===8 ? 'ui.countin_8' : 'ui.countin_4') : tt('ui.countin_off');
  const seg=document.getElementById('countSeg');
  if(!seg) return;
  seg.classList.toggle('off', !ST.countIn);
  seg.querySelectorAll('button').forEach(b=> b.classList.toggle('on', (+b.dataset.count)===ST.countBeats));
}
/* 歯車の一覧に出す「言語」の要約（いま選ばれている言語名）。サブメニューを開かなくても分かるように。
   言語名は <select> の <option> が持っている（PHP が includes/lang/*.php の name を出力している）ので、
   JS 側に言語名の一覧を持たずに済む。 */
export function syncLangRow(){
  const r=document.getElementById('langRowV');
  if(!r) return;
  const sel=document.getElementById('langSel');
  const op=sel ? sel.options[sel.selectedIndex] : null;
  r.textContent = op ? op.textContent : '';
}
/* 歯車の一覧に出す「音量」の要約（全体の値）。サブメニューを開かなくても分かるように */
export function syncVolRow(){
  const r=document.getElementById('volRowV');
  if(r) r.textContent=Math.round((ST.vol.master||0)*100)+'%';
}

/* ===== 運指の保存 ===== */
function sigOf(prefix){
  const n=ST.events.length;
  if(!n) return prefix+'empty';
  const a=ST.events[0].pitches[0].midi;
  const b=ST.events[n-1].pitches[0].midi;
  const s=(ST.scoreName||'')+'|'+n+'|'+a+'|'+b;
  let h=0;
  for(let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))|0; }
  return prefix+(h>>>0).toString(36)+':'+n;
}
export function scoreSig(){ return sigOf(KEY_PREFIX); }
export function fingerData(){
  return ST.events.map(e=>({
    l:e.leadIdx,
    s:e.fing?e.fing.str:null,
    o:e.fing?e.fing.off:null,
    f:e.fing?e.fing.finger:null,
    m:e.fing?!!e.fing.manual:false
  }));
}
export function applyFingerData(data){
  if(!Array.isArray(data) || data.length!==ST.events.length) return false;
  data.forEach((d,i)=>{
    const ev=ST.events[i]; if(!ev) return;
    if(typeof d.l==='number' && d.l>=0 && d.l<ev.pitches.length) ev.leadIdx=d.l;
    if(d.s!=null && d.o!=null && d.m){
      /* 手で直した運指だけ復元する */
      const z=zoneOf(d.o);
      /* 保存してある番号をそのまま戻す。空で保存されていれば空のまま（目安で埋めない） */
      ev.fing={str:d.s, off:d.o, frac:fracOf(d.o), zone:z.zone, klass:z.klass, finger:(d.f ?? null), manual:true};
    }else{
      /* 自動ぶんは「今の推奨ポジション」で計算し直す。
         保存時のポジションをそのまま復元すると、ロー/ミドル/ハイを切り替えても
         譜面を読み込み直した時点で元に戻ってしまうため。 */
      ev.fing=recommend(ev.pitches[ev.leadIdx].midi);
    }
  });
  return true;
}
export let saveTimer=0;
/* 運指が保存されたときの通知先（src/uploads.js が登録する）。
   アップロードした譜面を開いているあいだは、その譜面の運指もサーバへ持っていくため。
   drawer.js から uploads.js を import しないのは、依存の向きを増やさないため
   （account.js の setSaveWatcher と同じ作法）。 */
let onFingSaved=null;
export function setFingWatcher(fn){ onFingSaved=fn; }
export function saveFingering(){
  if(!ST.events.length) return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    Store.set(scoreSig(), JSON.stringify({v:1, name:ST.scoreName, data:fingerData()}));
    settingsChanged();        /* 指番号・運指の変更もサーバへ持っていく */
    if(onFingSaved){ try{ onFingSaved(); }catch(e){} }
  }, 250);
}
export function loadFingering(){
  const raw=Store.get(scoreSig()) || legacyGet(sigOf(LEGACY_PREFIX)); if(!raw) return false;
  try{ const j=JSON.parse(raw); return applyFingerData(j.data); }catch(e){ return false; }
}
export function exportFingering(){
  if(!ST.events.length){ toast(tt('msg.need_score')); return; }
  const j={v:1, name:ST.scoreName, sig:scoreSig(), data:fingerData()};
  const blob=new Blob([JSON.stringify(j,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(ST.scoreName||'fingering').replace(/[^\w.-]+/g,'_')+'.fing.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  toast(tt('msg.fing_exported'));
}
export async function importFingering(file){
  try{
    const j=JSON.parse(await file.text());
    if(!applyFingerData(j.data)){ toast(tt('msg.fing_mismatch')); return; }
    saveFingering(); render();
    toast(tt('msg.fing_imported'));
  }catch(e){ toast(tt('msg.load_failed', e.message)); }
}
export function resetFingering(){
  if(!ST.events.length) return;
  ST.events.forEach(ev=>{ ev.leadIdx=ev.pitches.length-1; ev.fing=recommend(ev.pitches[ev.leadIdx].midi); });
  Store.del(scoreSig());
  render();
  toast(tt('msg.fing_reset_done'));
}

/* ドロワーを開く。body.drawer-open は、開いているあいだだけ案内文（.empty）を
   黒いスクリムより上へ出すために使う（CSS: body.drawer-open .empty）。 */
export function openDrawer(){ document.getElementById('drawer').classList.add('open'); document.getElementById('scrim').classList.add('show'); document.body.classList.add('drawer-open'); }
export function openGear(){ openGearPage('main'); document.getElementById('gearPanel').classList.add('open'); document.getElementById('gearScrim').classList.add('open'); }
/* ===== 歯車：サブメニュー（音量 / 指板ズーム） =====
   iPhoneの設定と同じで、表示するページは常に1枚だけ。開き直したら必ず一覧に戻す。
   back=true は「戻る」方向＝逆向きに差し込む。 */
export function openGearPage(name, back){
  const panel=document.getElementById('gearPanel');
  if(!panel) return;
  panel.querySelectorAll('.gp-page').forEach(p=>{
    const on=(p.dataset.gp===name);
    p.classList.toggle('on', on);
    p.classList.toggle('back', on && !!back);
  });
  panel.scrollTop=0;
}
export function closeGear(){ document.getElementById('gearPanel').classList.remove('open'); document.getElementById('gearScrim').classList.remove('open'); clearPlayAttn(); }
export function toggleGear(){ document.getElementById('gearPanel').classList.contains('open') ? closeGear() : openGear(); }
export function closeDrawer(){ document.getElementById('drawer').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); document.body.classList.remove('drawer-open'); clearPlayAttn(); }
/* ===== コピー練習モードの子タブ（曲を選ぶ / 譜面を読み込む / MIDIトラック選択） =====
   'tracks' はタブを持たない面で、MIDIを読み込んだときに songs.js から切り替える
   （「‹ 戻る」で 'load' に戻る）。main.js と songs.js の両方から呼ぶので drawer.js に置く。 */
export function setScoreSub(sub){
  document.querySelectorAll('#scoreSubSeg button').forEach(b=> b.classList.toggle('on', b.dataset.sub===sub));
  document.querySelectorAll('.subpanel').forEach(p=> p.classList.toggle('m-hide', p.dataset.sub!==sub));
}

/* ===== 画面左下ドックのモーダル（テンポ / オクターブ / ループ） ===== */
/* モーダルの開閉は dom.js へ移した（トップページからも使うため）。
   これまでどおり drawer.js から import できるよう、そのまま再輸出する。 */
import { openDockModal, closeDockModal } from './dom.js';
export { openDockModal, closeDockModal };
/* 曲を練習：入口（モード選択）から入った時に出していた案内モーダル（#mScoreStart）は廃止した。
   いまは modes.js の setMode() が openDrawer() で左ドロワーを直接開く。 */
