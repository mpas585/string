/*
  notation.js — 五線譜レンダラ。元 cello-finger.html L1387–1512 より無改変で移植。
    DIA/SHARP/diatonicIndex        … L1388–1393
    staffSig/staffSignature        … L1394–1400
    updateStaffActive              … L1401–1416（現在音のハイライトのみ差し替え）
    renderStaff/buildStaff/scrollStaffToActive … L1417–1512
  依存は state（ST）のみ。五線譜は独自座標系のため fingerboard/util 非依存。
  ※ render 統括（modes）と transportTick（scheduler）から同期呼び出しされるため静的 import。
*/
import { ST } from './state.js';

/* MIDI → 音名インデックス（C=0..B=6）と臨時記号 */
export const DIA=[0,0,1,1,2,3,3,4,4,5,5,6];      /* 半音→白鍵インデックス */
export const SHARP=[0,1,0,1,0,0,1,0,1,0,1,0];    /* シャープが必要か */
export function diatonicIndex(midi){             /* C4 を 0 とした白鍵段数 */
  const oct=Math.floor(midi/12)-1, pc=((midi%12)+12)%12;
  return (oct-4)*7 + DIA[pc];
}
export let staffSig='';
export function staffSignature(){
  return [ST.events.length, ST.scoreName, ST.octShift, (ST.zoom||1).toFixed(2), ST.view,
          document.body.classList.contains('landscape-layout'),
          ST.events.map(e=> e.fing ? (e.fing.str+''+e.fing.finger) : '-').join(',')].join('|');
}
/* 現在音のハイライトだけ差し替える（再構築しない＝スクロール位置を壊さない） */
export function updateStaffActive(){
  const box=document.getElementById('staffview');
  if(!box) return;
  const act = (ST.current!=null) ? ST.current : ST.selected;
  box.querySelectorAll('[data-nid]').forEach(el=>{
    const on = (+el.dataset.nid === act);
    if(el.classList.contains('nk-fg')){
      el.setAttribute('fill', on ? 'var(--accent)' : 'var(--muted)');
    } else {
      const base = (el.dataset.ok==='1') ? 'var(--ink)' : 'var(--danger)';
      const col  = on ? 'var(--accent)' : base;
      if(el.tagName.toLowerCase()==='line') el.setAttribute('stroke', col);
      else el.setAttribute('fill', col);
    }
  });
}
export function renderStaff(){
  const box0=document.getElementById('staffview');
  if(!box0) return;
  const sig=staffSignature();
  if(sig===staffSig && box0.querySelector('svg')){
    updateStaffActive();
    scrollStaffToActive();
    return;
  }
  staffSig=sig;
  buildStaff();
  updateStaffActive();
  scrollStaffToActive();
}
export function buildStaff(){
  const box=document.getElementById('staffview');
  if(!box) return;
  if(!ST.events.length){ box.innerHTML=''; return; }

  /* 音域からクレフを決める（高ければト音） */
  const mids=ST.events.map(e=>e.pitches[e.leadIdx].midi).sort((a,b)=>a-b);
  const med=mids[Math.floor(mids.length/2)];
  const treble = med >= 57;                        /* A3 以上ならト音 */
  const H=190, TOP=58, SPACE=9;                    /* viewBoxの線間 */
  /* 基準：ト音は E4(=diatonicIndex 2) が第1線、ヘ音は G2(=-16) が第1線 */
  const baseIdx = treble ? diatonicIndex(64) : diatonicIndex(43);
  const lineY = i => (TOP + 4*SPACE) - (i - baseIdx) * (SPACE/2);

  const NW=34;                                     /* 音符1つの横幅 */
  const LEFT=54;
  const W = LEFT + ST.events.length*NW + 30;
  const p=[];
  p.push(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`);
  /* 五線 */
  for(let i=0;i<5;i++){
    const y=TOP+i*SPACE;
    p.push(`<line x1="6" y1="${y}" x2="${W-6}" y2="${y}" stroke="var(--muted)" stroke-width="1" opacity="0.55"/>`);
  }
  /* クレフ */
  p.push(`<text x="12" y="${TOP+4*SPACE-2}" font-size="${treble?46:38}" fill="var(--ink)">${treble?'𝄞':'𝄢'}</text>`);

  let curM=-1;
  ST.events.forEach((ev,i)=>{
    const x=LEFT+i*NW+NW/2;
    if(ev.measure!==curM){
      curM=ev.measure;
      if(i>0) p.push(`<line x1="${x-NW/2-4}" y1="${TOP}" x2="${x-NW/2-4}" y2="${TOP+4*SPACE}" stroke="var(--line)" stroke-width="1.5"/>`);
      p.push(`<text x="${x-NW/2-2}" y="${TOP-10}" font-size="9" fill="var(--faint)" font-family="var(--mono)">${curM}</text>`);
    }
    const midi=ev.pitches[ev.leadIdx].midi;
    const di=diatonicIndex(midi);
    const y=lineY(di);
    const active = (ev.id===ST.current) || (ev.id===ST.selected && ST.current==null);
    const col = active ? 'var(--accent)' : (ev.fing ? 'var(--ink)' : 'var(--danger)');
    /* 加線 */
    const topLine=TOP, botLine=TOP+4*SPACE;
    for(let yy=botLine+SPACE; yy<=y+0.1; yy+=SPACE) p.push(`<line x1="${x-9}" y1="${yy}" x2="${x+9}" y2="${yy}" stroke="var(--muted)" stroke-width="1" opacity="0.5"/>`);
    for(let yy=topLine-SPACE; yy>=y-0.1; yy-=SPACE) p.push(`<line x1="${x-9}" y1="${yy}" x2="${x+9}" y2="${yy}" stroke="var(--muted)" stroke-width="1" opacity="0.5"/>`);
    /* 臨時記号 */
    if(SHARP[((midi%12)+12)%12]) p.push(`<text x="${x-16}" y="${y+4}" font-size="13" fill="${col}">♯</text>`);
    /* 符頭＋符幹 */
    const ok = ev.fing ? '1' : '0';
    p.push(`<ellipse class="nh nk" data-id="${ev.id}" data-nid="${ev.id}" data-ok="${ok}" cx="${x}" cy="${y}" rx="5.6" ry="4.3" fill="${col}" transform="rotate(-18 ${x} ${y})"/>`);
    const up = y > TOP+2*SPACE;
    p.push(`<line class="nk-st" data-nid="${ev.id}" data-ok="${ok}" x1="${up?x+5.4:x-5.4}" y1="${y}" x2="${up?x+5.4:x-5.4}" y2="${up?y-26:y+26}" stroke="${col}" stroke-width="1.4"/>`);
    /* 運指番号 */
    if(ev.fing) p.push(`<text class="nk-fg" data-nid="${ev.id}" x="${x}" y="${up? y-32 : y+38}" font-size="10" text-anchor="middle" fill="${active?'var(--accent)':'var(--muted)'}" font-family="var(--mono)">${ev.fing.finger}</text>`);
    /* タップ領域 */
    p.push(`<rect class="nh" data-id="${ev.id}" x="${x-NW/2}" y="6" width="${NW}" height="${H-12}" fill="transparent"/>`);
  });
  p.push('</svg>');
  box.innerHTML = `<div class="stf-wrap" id="stfwrap">${p.join('')}</div>`;
  /* 画面の高さいっぱいに拡大（ズーム設定も反映） */
  const wrap=document.querySelector('.board-full');
  const svg=box.querySelector('svg');
  if(wrap && svg && wrap.clientHeight){
    const cs=getComputedStyle(wrap);
    const availH=wrap.clientHeight - parseFloat(cs.paddingTop||0) - parseFloat(cs.paddingBottom||0);
    const hpx=Math.max(170, Math.min(availH*0.96, 520)) * Math.max(0.6, Math.min(2.2, ST.zoom));
    svg.setAttribute('height', hpx.toFixed(0));
    svg.setAttribute('width',  (W * hpx / H).toFixed(0));
    svg.style.width='auto'; svg.style.height=hpx.toFixed(0)+'px';
    box.dataset.nw = (NW * hpx / H).toFixed(2);
    box.dataset.left = (LEFT * hpx / H).toFixed(2);
  }
}
export function scrollStaffToActive(){
  const w=document.getElementById('stfwrap');
  const box=document.getElementById('staffview');
  if(!w || !box || !w.clientWidth) return;
  const id=(ST.current!=null)?ST.current:ST.selected;
  if(id==null) return;
  const NW=parseFloat(box.dataset.nw||34), LEFT=parseFloat(box.dataset.left||54);
  const x=LEFT + id*NW + NW/2;
  w.scrollTo({left: Math.max(0, x - w.clientWidth/2), behavior:'smooth'});
}
