/*
  drawer.js — ストレージ・設定の保存/復元・運指の保存/読込・ドロワー/ギア/PDF開閉。
  元 cello-finger.html より無改変で移植。
    Store（localStorage / 不可環境はメモリ）      … L1870–1882
    SETTINGS_KEY/saveSettings/loadSettings/syncSettingsUI … L1883–1944
    scoreSig/fingerData/applyFingerData          … L1945–1975
    saveTimer/saveFingering/loadFingering         … L1976–1987
    exportFingering/importFingering/resetFingering … L1988–2013
    openDrawer/openGear/closeGear/toggleGear/closeDrawer/openPdfOverlay/closePdfOverlay … L3491–3497
  依存: state(ST/volProfileKey), util(fracOf/zoneOf/fingerHint), fingerboard(recommend),
        modes(render/syncLayoutClass), dom(toast), pdf(pdfDoc/renderPdfPage)。
  ※ pdf は Batch7 で作成。それまで PDF開閉のみ実行時未解決（構文・元一致は検証済み）。
*/
import { ST, volProfileKey, VOL_KEYS } from './state.js';
import { fracOf, zoneOf, fingerHint, INSTRUMENT_ID } from './util.js';
import { recommend } from './fingerboard.js';
import { SCALES } from './scale.js';
import { render, syncLayoutClass, syncDock } from './modes.js';
import { toast } from './dom.js';
import { pdfDoc, renderPdfPage } from './pdf.js';

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
    volProfiles:ST.volProfiles, volBump:VOL_BUMP, countIn:ST.countIn, keepAwake:ST.keepAwake,
    tempo:ST.tempo, enjoy:ST.enjoy, loop:ST.loop, lang:ST.lang,
    keyRoot:ST.keyRoot, scaleType:ST.scaleType, scaleOct:ST.scaleOct
  }));
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
    if(typeof j.keepAwake==='boolean') ST.keepAwake=j.keepAwake;
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
  document.getElementById('fretSw').classList.toggle('on', ST.frets);
  document.getElementById('landSw').classList.toggle('on', ST.landscape);
  document.body.classList.toggle('force-landscape', ST.landscape);
  syncLayoutClass();
  document.querySelectorAll('.pref').forEach(b=> b.classList.toggle('on', b.dataset.pref===ST.pref));
  document.querySelectorAll('.oct').forEach(b=> b.classList.toggle('on', String(b.dataset.oct)===String(ST.octave)));
  document.getElementById('enjoySw').classList.toggle('on', ST.enjoy);
  document.getElementById('scaleRoot').value=String(ST.keyRoot);
  document.getElementById('scaleType').value=ST.scaleType;
  document.getElementById('scaleOct').value=String(ST.scaleOct);
  document.getElementById('tempo').value=ST.tempo;
  document.getElementById('tempoval').textContent=ST.tempo+' bpm';
  document.getElementById('countSw').classList.toggle('on', ST.countIn);
  document.getElementById('awakeSw').classList.toggle('on', ST.keepAwake);
  const langEl=document.getElementById('langSel');
  if(langEl) langEl.value=ST.lang;
  ST.vol = ST.volProfiles[volProfileKey()];
  for(const k of VOL_KEYS){
    const id='vol'+k[0].toUpperCase()+k.slice(1);
    const el=document.getElementById(id), lb=document.getElementById(id+'V');
    const v=Math.round(ST.vol[k]*100);
    if(el) el.value=v;
    if(lb) lb.textContent=v;
  }
  syncDock();
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
      ev.fing={str:d.s, off:d.o, frac:fracOf(d.o), zone:z.zone, klass:z.klass, finger:d.f||fingerHint(d.o), manual:true};
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
export function saveFingering(){
  if(!ST.events.length) return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    Store.set(scoreSig(), JSON.stringify({v:1, name:ST.scoreName, data:fingerData()}));
  }, 250);
}
export function loadFingering(){
  const raw=Store.get(scoreSig()) || legacyGet(sigOf(LEGACY_PREFIX)); if(!raw) return false;
  try{ const j=JSON.parse(raw); return applyFingerData(j.data); }catch(e){ return false; }
}
export function exportFingering(){
  if(!ST.events.length){ toast('先に譜面を読み込んでください'); return; }
  const j={v:1, name:ST.scoreName, sig:scoreSig(), data:fingerData()};
  const blob=new Blob([JSON.stringify(j,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(ST.scoreName||'fingering').replace(/[^\w.-]+/g,'_')+'.fing.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  toast('運指を書き出しました');
}
export async function importFingering(file){
  try{
    const j=JSON.parse(await file.text());
    if(!applyFingerData(j.data)){ toast('音符数が一致しません（別の譜面の可能性）'); return; }
    saveFingering(); render();
    toast('運指を読み込みました');
  }catch(e){ toast('読み込めません：'+e.message); }
}
export function resetFingering(){
  if(!ST.events.length) return;
  ST.events.forEach(ev=>{ ev.leadIdx=ev.pitches.length-1; ev.fing=recommend(ev.pitches[ev.leadIdx].midi); });
  Store.del(scoreSig());
  render();
  toast('運指をリセットしました');
}

export function openDrawer(){ document.getElementById('drawer').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
export function openGear(){ document.getElementById('gearPanel').classList.add('open'); document.getElementById('gearScrim').classList.add('open'); }
export function closeGear(){ document.getElementById('gearPanel').classList.remove('open'); document.getElementById('gearScrim').classList.remove('open'); }
export function toggleGear(){ document.getElementById('gearPanel').classList.contains('open') ? closeGear() : openGear(); }
export function closeDrawer(){ document.getElementById('drawer').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }
export function openPdfOverlay(){ document.getElementById('pdfOverlay').classList.add('open'); if(pdfDoc) renderPdfPage(); }
export function closePdfOverlay(){ document.getElementById('pdfOverlay').classList.remove('open'); }

/* ===== 画面左下ドックのモーダル（テンポ / オクターブ / ループ） ===== */
export function openDockModal(id){
  document.querySelectorAll('.dkmodal').forEach(m=> m.classList.toggle('open', m.id===id));
  document.getElementById('dockScrim').classList.add('open');
}
export function closeDockModal(){
  document.querySelectorAll('.dkmodal').forEach(m=> m.classList.remove('open'));
  document.getElementById('dockScrim').classList.remove('open');
}
