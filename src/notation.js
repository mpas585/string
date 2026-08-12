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
/* ===== 音部記号 =====
   使う記号は config/{楽器}.php の 'clef'（PHP が window.INSTRUMENT.clef に出力）で決める。
   'auto' または未指定のときは従来どおり音域の中央値で ト音／ヘ音 を選ぶ（チェロはこれ）。
     glyph … 記号の文字
     size  … 文字の大きさ
     dy    … 第1線（いちばん下の線）からの縦のずれ
     base  … 第1線に来る音の MIDIノート番号
             ト音＝E4(64) / アルト＝F3(53) / ヘ音＝G2(43)
             （アルト記号は第3線が C4 なので、第1線はその2度分下の F3 になる）
   ※ size と dy は表示を見ながら決めた値。記号の見え方は端末のフォントで変わるので、
      上下にずれて見えるときはここだけを直せばよい。
      treble / bass の値は楽器別対応より前と同じ（＝チェロの見え方は変わらない）。 */
export const CLEFS = {
  treble: {glyph:'𝄞', size:46, dy:-2, base:64},
  alto:   {glyph:'𝄡', size:36, dy: 0, base:53},
  bass:   {glyph:'𝄢', size:38, dy:-2, base:43},
};
const CLEF_PREF = (typeof window!=='undefined' && window.INSTRUMENT && window.INSTRUMENT.clef) || 'auto';
/* 使う音部記号を返す。med＝音域の中央値（'auto' のときだけ見る） */
export function clefOf(med){
  if(CLEFS[CLEF_PREF]) return CLEFS[CLEF_PREF];
  return (med >= 57) ? CLEFS.treble : CLEFS.bass;   /* A3 以上ならト音（従来どおり） */
}

export let staffSig='';
export function staffSignature(){
  return [ST.events.length, ST.scoreName, ST.octShift, (ST.zoom||1).toFixed(2), ST.view,
          document.body.classList.contains('landscape-layout'),
          ST.events.map(e=> e.fing ? (e.fing.str+''+(e.fing.finger ?? '')) : '-').join(',')].join('|');
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

  /* 音部記号は楽器で決まる（'auto' のときだけ音域の中央値で選ぶ） */
  const mids=ST.events.map(e=>e.pitches[e.leadIdx].midi).sort((a,b)=>a-b);
  const med=mids[Math.floor(mids.length/2)];
  const CLEF=clefOf(med);
  const H=190, TOP=58, SPACE=9;                    /* viewBoxの線間 */
  /* 基準：CLEF.base の音が第1線（いちばん下の線）に来る */
  const baseIdx = diatonicIndex(CLEF.base);
  const lineY = i => (TOP + 4*SPACE) - (i - baseIdx) * (SPACE/2);

  const NW=34;                                     /* 音符1つの横幅 */
  const LEFT=54;
  /* 音価に比例した横幅で並べる（長い音＝広い／短い音＝狭い）。まず合計幅を出して W を決める。 */
  const __bpm=ST.beatsPerMeasure||4;
  /* 幅＝音の長さ×一定値（PPB）。1小節ぶんは常に beatsPerMeasure×PPB＝固定幅。短すぎる音だけ最小幅を確保。 */
  const PPB=34, wOf=d=> Math.max(12, Math.round(d*PPB));
  let __tot=0, __cur=-1;
  ST.events.forEach(ev=>{
    if(ev.measure!==__cur){ if(__cur>=0 && ev.measure>__cur+1){ for(let mm=__cur+1; mm<ev.measure; mm++) __tot+=wOf(__bpm); } __cur=ev.measure; }
    const nEnd=ev.onset+ev.dur, mEnd=ev.measure*__bpm;
    __tot+=wOf(Math.min(nEnd,mEnd)-ev.onset);
    const em=Math.floor((nEnd-1e-6)/__bpm)+1;
    if(em>ev.measure){ for(let mm=ev.measure+1; mm<=em; mm++) __tot+=wOf(Math.min(nEnd,mm*__bpm)-(mm-1)*__bpm); if(em>__cur) __cur=em; }
  });
  const W = LEFT + __tot + 40;
  const p=[];
  p.push(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`);
  /* 五線 */
  for(let i=0;i<5;i++){
    const y=TOP+i*SPACE;
    p.push(`<line x1="6" y1="${y}" x2="${W-6}" y2="${y}" stroke="var(--muted)" stroke-width="1" opacity="0.55"/>`);
  }
  /* クレフ */
  p.push(`<text x="12" y="${TOP+4*SPACE+CLEF.dy}" font-size="${CLEF.size}" fill="var(--ink)">${CLEF.glyph}</text>`);

  let curM=-1, xcur=LEFT;
  ST.events.forEach(ev=>{
    /* 音符が無い小節（休符だけ）にも枠を割り当て、番号を飛ばさず出す */
    if(ev.measure!==curM && curM>=0 && ev.measure>curM+1){
      for(let mm=curM+1; mm<ev.measure; mm++){
        p.push(`<line x1="${xcur-4}" y1="${TOP}" x2="${xcur-4}" y2="${TOP+4*SPACE}" stroke="var(--line)" stroke-width="1.5"/>`);
        p.push(`<text x="${xcur-2}" y="${TOP-10}" font-size="9" fill="var(--faint)" font-family="var(--mono)">${mm}</text>`);
        xcur+=wOf(__bpm);
      }
    }
    const nEnd=ev.onset+ev.dur, mEnd=ev.measure*__bpm;
    const cw=wOf(Math.min(nEnd,mEnd)-ev.onset);
    const x=xcur+cw/2;
    if(ev.measure!==curM){
      curM=ev.measure;
      if(xcur>LEFT+0.5) p.push(`<line x1="${xcur-4}" y1="${TOP}" x2="${xcur-4}" y2="${TOP+4*SPACE}" stroke="var(--line)" stroke-width="1.5"/>`);
      p.push(`<text x="${xcur-2}" y="${TOP-10}" font-size="9" fill="var(--faint)" font-family="var(--mono)">${curM}</text>`);
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
    if(ev.fing && ev.fing.finger) p.push(`<text class="nk-fg" data-nid="${ev.id}" x="${x}" y="${up? y-32 : y+38}" font-size="10" text-anchor="middle" fill="${active?'var(--accent)':'var(--muted)'}" font-family="var(--mono)">${ev.fing.finger}</text>`);
    /* タップ領域 */
    p.push(`<rect class="nh" data-id="${ev.id}" x="${xcur}" y="6" width="${cw}" height="${H-12}" fill="transparent"/>`);
    xcur+=cw;
    /* タイ：小節をまたいで伸びる音は、続く小節にも符頭とタイ弧を出す（表示だけ＝参考楽譜と同じ見え方）。 */
    const endM=Math.floor((nEnd-1e-6)/__bpm)+1;
    if(endM>curM){
      let prevx=x;
      for(let mm=curM+1; mm<=endM; mm++){
        const segDur=Math.min(nEnd,mm*__bpm)-(mm-1)*__bpm;
        const sw=wOf(segDur);
        p.push(`<line x1="${xcur-4}" y1="${TOP}" x2="${xcur-4}" y2="${TOP+4*SPACE}" stroke="var(--line)" stroke-width="1.5"/>`);
        p.push(`<text x="${xcur-2}" y="${TOP-10}" font-size="9" fill="var(--faint)" font-family="var(--mono)">${mm}</text>`);
        const hx=xcur+sw/2;
        const midx=(prevx+hx)/2;
        p.push(`<path d="M ${prevx} ${y+7} Q ${midx} ${y+15} ${hx} ${y+7}" fill="none" stroke="var(--muted)" stroke-width="1.2" opacity="0.7"/>`);
        p.push(`<ellipse class="nh nk" data-id="${ev.id}" data-nid="${ev.id}" data-ok="1" cx="${hx}" cy="${y}" rx="5.6" ry="4.3" fill="${col}" opacity="0.5" transform="rotate(-18 ${hx} ${y})"/>`);
        prevx=hx; xcur+=sw;
      }
      curM=endM;
    }
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
    box.dataset.left = (LEFT * hpx / H).toFixed(2);
  }
}
export function scrollStaffToActive(){
  const w=document.getElementById('stfwrap');
  const box=document.getElementById('staffview');
  if(!w || !box || !w.clientWidth) return;
  const id=(ST.current!=null)?ST.current:ST.selected;
  if(id==null) return;
  /* 音価比例レイアウトでは位置が添字×幅では出せないので、実際の符頭要素の位置を使う。 */
  const svg=box.querySelector('svg');
  const head=box.querySelector(`ellipse.nk[data-nid="${id}"]`);
  if(svg && head){
    const vb=svg.viewBox && svg.viewBox.baseVal;
    const scale=(vb && vb.width) ? (svg.getBoundingClientRect().width / vb.width) : 1;
    const cx=parseFloat(head.getAttribute('cx'))*scale;
    w.scrollTo({left: Math.max(0, cx - w.clientWidth/2), behavior:'smooth'});
    return;
  }
  /* 念のためのフォールバック（要素が取れないとき） */
  const LEFT=parseFloat(box.dataset.left||54);
  w.scrollTo({left: Math.max(0, LEFT + id*34 - w.clientWidth/2), behavior:'smooth'});
}
