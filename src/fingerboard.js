/*
  fingerboard.js — 指板の描画・座標変換・弦振動・ズーム。
  元 cello-finger.html より無改変で移植（行頭宣言に export を付与）。
    optionsFor / recommend           … L1039–1058
    FB/yOf/offOfY/MARKERS 〜 vibLoop  … L1159–1335（描画コア＋振動）
    scrollBoardToActive              … L2715–2730
    ZOOM_MIN/MAX / baseBoardWidth / applyZoom … L3430–3447
    zoomFitPositions / zoomFit        … L3455–3479
  ※ setZoom（L3448–3454）は saveSettings 依存のため Batch5 へ。
  ※ render（全体統括, L1338）・fbsvg配線（L3600–）は tuner/notation/edit 依存のため Batch5 へ。
  公開API: renderBoard（署名変化時に指板を作り直し＋音符描画）, pluckString/pluckEvent,
           optionsFor/optionsForAll/recommend, applyZoom/zoomFit/zoomFitPositions, scrollBoardToActive, yOf/offOfY, FB。
*/
import { OPEN, STRNAME, NOTE_NAMES, fracOf, midiName, zoneOf, fingerHint, strFingerText, tt, setNowLine } from './util.js';
import { ST } from './state.js';
import { toast } from './dom.js';
import { midiFreq } from './audio/synth.js';
import { MASTER_BOOST, makeLimiter } from './audio/context.js';
import { renderNow } from './modes.js';

/* ===== ゾーン別の運指候補と推奨 ===== */
export function optionsFor(midi){
  const out=[];
  for(let i=0;i<4;i++){
    const off = midi - OPEN[i];
    if(off>=0 && off<=FB.maxOff){
      const z = zoneOf(off);
      out.push({str:i, off, frac:fracOf(off), zone:z.zone, klass:z.klass, finger:fingerHint(off)});
    }
  }
  return out;
}
/* 運指編集シート用：1〜4弦すべてから候補を出す。
   optionsFor() は「その高さがそのまま押さえられる弦」しか返さないので、
   音域の端の音では1〜2本しか出てこない（例：チェロのA線しか出ない高い音）。
   ここでは同じ音名（1・2オクターブ上下）の位置も候補に入れて、どの弦でも
   選べるようにする。oct は元の高さからの半音差（0 / ±12 / ±24）。
   鳴る音は譜面のままで、変わるのは指板に出る押さえる位置だけ。 */
const OCT_TRY=[0,-12,12,-24,24];
export function optionsForAll(midi){
  const out=[];
  for(let i=0;i<4;i++){
    for(const oc of OCT_TRY){
      const off = (midi+oc) - OPEN[i];
      if(off<0 || off>FB.maxOff) continue;
      const z = zoneOf(off);
      out.push({str:i, oct:oc, off, frac:fracOf(off), zone:z.zone, klass:z.klass, finger:fingerHint(off)});
    }
  }
  /* 並びは弦ごとのまとまりで、4弦→1弦（太い弦から細い弦へ＝OPEN の順）。
     その中は開放に近いほうから（ロー→ミドル→ハイ）。
     OCT_TRY の順（0→−1oct→+1oct…）のままだと、弦の中でハイが先に出てしまう。 */
  out.sort((a,b)=> (a.str-b.str) || (a.off-b.off));
  return out;
}
/* 推奨ポジ設定に応じて1つ選ぶ。
   弦とポジションは決めるが、指番号は入れない（finger:null）。
   どの指で押さえるかは人と手の大きさで変わるので、利用者に決めてもらう。
   目安の番号そのものは optionsFor() の finger に残してある。 */
export function recommend(midi){
  const o = optionsFor(midi);
  if(!o.length) return null;
  if(ST.pref==='low')       o.sort((a,b)=> a.off-b.off);
  else if(ST.pref==='high') o.sort((a,b)=> b.off-a.off);
  else                      o.sort((a,b)=> Math.abs(a.off-10)-Math.abs(b.off-10));
  const c=o[0];
  return {str:c.str, off:c.off, frac:c.frac, zone:c.zone, klass:c.klass, finger:null, manual:false};
}

/* ===== スラー ===== */
/* いまのイベント添字が属するスラーの連結成分 [開始,終了] を返す。無ければ null。
   （入れ子/隣接のスラーはまとめた成分で扱う＝同じ弦がひと続きになる） */
export function slurGroupOf(id){
  const S = ST.slurComps;
  if(!S || !S.length || id==null) return null;
  for(let k=0;k<S.length;k++){ const g=S[k]; if(id>=g[0] && id<=g[1]) return g; }
  return null;
}
/* 群の主音（各イベントの leadIdx の音）をまとめて返す。 */
export function slurLeadMidis(g){
  const out=[];
  for(let i=g[0]; i<=g[1]; i++){ const ev=ST.events[i]; if(ev) out.push(ev.pitches[ev.leadIdx].midi); }
  return out;
}
/* その半音差(oc)を全音に足したとき、群の全音が1本で押さえられる弦の一覧。 */
export function slurCommonStrings(midis, oc){
  const o=(typeof oc==='number' && !isNaN(oc)) ? oc : 0;
  const out=[];
  for(let i=0;i<OPEN.length;i++){
    let ok=true;
    for(const m of midis){ const off=(m+o)-OPEN[i]; if(off<0 || off>FB.maxOff){ ok=false; break; } }
    if(ok) out.push(i);
  }
  return out;
}

/* ===== 指板描画 ===== */
/* 表示する半音数と指板SVGの寸法は config/{楽器}.php（PHPが window.INSTRUMENT に出力）から。
   未注入のときは従来どおりチェロの値。fmax は maxOff に追従させる
   （別々に持つと、maxOff を変えても座標変換が旧値のままになるため）。 */
const _I = (typeof window!=='undefined' && window.INSTRUMENT) ? window.INSTRUMENT : {};
/* 指板の下端。実物の指板の先端に合わせる。
   4/4チェロは 指板長 578〜583mm / 弦長 690〜700mm（Strobel の寸法表は 580 / 695）。
   580/695 = 83.5% → 12*log2(1/(1-0.835)) = 31.1 → off 31（ナットから 579.0mm）。
   白鳥の最高音 D6（A線 off29 = 564.8mm）も範囲内。 */
const MAXOFF = _I.maxOff || 31;
const BOARD = _I.board || {
  /* vbW は左右の余白を対称にするための値。
     板は bx=56 / bw=240 なので右端は 296。右の余白を左と同じ56にすると 352 になり、
     板の中心 176 がちょうど 352/2 に一致する。
     320 のままだと右余白が24しかなく、「親指」「12th」等のポジション名が切れる。 */
  vbW:352, vbH:1300,
  bx:56, bw:240,                  /* 指板の左端と幅 */
  strX:[86,146,206,266], strW:[6.0,4.8,3.7,2.7],
  topY:64, botY:1250
};
/* ネックとボディの接合部（開放弦からの半音数）。
   基準は【ナット → 表板の上端】＝ネック長。4/4チェロで 280mm。
   製作比 7:10 からは 12*log2(17/10)=9.19、実寸 280/695=40.3% からは 8.93。
   （280+400=680 に対し公表弦長が690〜700あるのは、駒で弦が立ち上がるぶん
     実振動長が2直線の和より長くなるため。）間をとって off 9 とする。
   板の中では 0→接合部=281.8mm、接合部→下端(off31)=297.2mm ＝ 接合部は板の48.7%。
   ヴァイオリン・ヴィオラはネック:ストップ=2:3 なので off≈8.8（比率8.84 / 実寸8.74）。
   config/{楽器}.php の 'body_off' で上書きできる。 */
const BODYOFF = (_I.bodyOff != null) ? _I.bodyOff : 9;
/* ボディ上端の弧の深さ（中央と左右端の高低差）。大きいほど急になる。
   アプリは横方向が縦の約2.5倍に引き伸ばされているため、実寸から素直に換算すると
   フレーム端までで31程度にしかならない。ここはその実寸相当の値を採る。 */
const BODYCURVE = (_I.bodyCurve != null) ? _I.bodyCurve : 30;
/* 指板に薄く重ねる音名で「幹音」を選ぶための集合（C D E F G A B の度数）。
   NOTE_NAMES は言語で Do Re Mi 等に差し替わるので、文字列ではなく度数で判定する。 */
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);
export const FB = Object.assign({}, BOARD, { maxOff:MAXOFF, fmax:fracOf(MAXOFF), bodyOff:BODYOFF, bodyCurve:BODYCURVE });
export function yOf(off){
  const f = Math.min(fracOf(off), FB.fmax);
  return FB.topY + (f/FB.fmax)*(FB.botY-FB.topY);
}
/* y座標 → 半音（タップ位置の逆算） */
export function offOfY(y){
  let f = (y-FB.topY)/(FB.botY-FB.topY)*FB.fmax;
  f = Math.max(0, Math.min(FB.fmax-0.0005, f));
  return -12*Math.log2(1-f);
}
/* ポジション標識（太線＋ラベル） */
/* config/{楽器}.php の markers から（ラベルは PHP 側で言語解決済み）。未注入時はチェロ */
export const MARKERS = _I.markers || [
  {off:1,  r:'½'},   {off:2,  r:'I'},   {off:4,  r:'II'},  {off:5,  r:'III'},
  {off:7,  r:'IV'},  {off:9,  r:'V'},   {off:11, r:'VI'},  {off:12, r:'8ve'},
  {off:14, r:'親指'}, {off:16, r:''},   {off:19, r:'12th'},{off:21, r:''}, {off:24, r:'15ma'},
  {off:26, r:''},    {off:28, r:''},    {off:29, r:'19th'}
];
export const MARKOFF = new Set(MARKERS.map(m=>m.off));

/* 指板の静的部分（内容が変わった時だけ作り直す） */
export function drawBoardStatic(){
  const parts=[];
  const bx=FB.bx, bw=FB.bw, br=bx+bw;
  parts.push(`<svg class="fb" viewBox="0 0 ${FB.vbW} ${FB.vbH}" xmlns="http://www.w3.org/2000/svg">`);

  /* ===== 楽器のボディ =====
     接合部から先が親指ポジション。それを形で分かるようにする。
     実寸比ではボディ幅が指板の7倍以上あり viewBox に到底収まらないので、
     胴の輪郭ではなく【上端だけ】を「中央が最も高く左右へ緩やかに下がる弧」として描く。
     実物も接合部が最高点でそこから肩が下がるので、見え方としては素直。
     二次ベジェ M 0,(y+c) Q cx,(y-c) vbW,(y+c) は t=0.5 で頂点が y に一致する。 */
  const yBody=yOf(FB.bodyOff), bc=FB.bodyCurve;
  const bodyPath=
    `M 0,${(yBody+bc).toFixed(0)}`+
    ` Q ${(FB.vbW/2).toFixed(0)},${(yBody-bc).toFixed(0)} ${FB.vbW},${(yBody+bc).toFixed(0)}`+
    ` L ${FB.vbW},${FB.vbH} L 0,${FB.vbH} Z`;
  /* 縁取りはしない。実物の輪郭ではなく上端だけの造形なので、
     線を引くと「ここが胴の縁」と読めてしまって誤解のもとになる。塗りだけで足りる */
  parts.push(`<path d="${bodyPath}" fill="var(--wood)" opacity="0.48"/>`);

  parts.push(`<rect x="${bx}" y="${FB.topY-14}" width="${bw}" height="${FB.botY-FB.topY+26}" rx="14" fill="var(--board)" stroke="var(--board-edge)"/>`);
  /* 板のうちボディに乗っている区間をわずかに温色へ。指板が胴の上を通っている感じを出す */
  parts.push(`<rect x="${bx}" y="${yBody.toFixed(1)}" width="${bw}" height="${(FB.botY-yBody+12).toFixed(1)}" fill="var(--wood)" opacity="0.18"/>`);

  const yLow=yOf(7), yMid=yOf(13);
  parts.push(`<rect x="${bx}" y="${FB.topY}" width="${bw}" height="${(yLow-FB.topY).toFixed(1)}" fill="var(--good)" opacity="0.045"/>`);
  parts.push(`<rect x="${bx}" y="${yLow.toFixed(1)}" width="${bw}" height="${(yMid-yLow).toFixed(1)}" fill="var(--accent)" opacity="0.045"/>`);
  parts.push(`<rect x="${bx}" y="${yMid.toFixed(1)}" width="${bw}" height="${(FB.botY-yMid).toFixed(1)}" fill="var(--danger)" opacity="0.045"/>`);

  /* 接合線。ここから先はネックを握れない＝親指ポジション。
     線と胴の塗りだけで位置は読み取れるので、文字ラベル（旧 zone.body）は出さない */
  parts.push(`<line x1="${bx}" y1="${yBody.toFixed(1)}" x2="${br}" y2="${yBody.toFixed(1)}" stroke="var(--wood)" stroke-width="2.4"/>`);

  if(ST.frets) for(let off=1; off<=FB.maxOff; off++){
    const y=yOf(off);
    const isMark=MARKOFF.has(off);
    const w=isMark?1.8:0.9, col=isMark?'#5a4b39':'#332b22';
    parts.push(`<line x1="${bx}" y1="${y.toFixed(1)}" x2="${br}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="${w}"/>`);
    parts.push(`<text x="${bx-6}" y="${(y+3.5).toFixed(1)}" fill="${isMark?'var(--muted)':'var(--faint)'}" font-size="10" text-anchor="end" font-family="var(--mono)">${off}</text>`);
    FB.strX.forEach((x,i)=>{
      parts.push(`<circle cx="${x}" cy="${y.toFixed(1)}" r="2.2" fill="var(--string)" opacity="${isMark?0.30:0.14}"/>`);
      /* 音名を指板の上に薄く重ねる（左端の数字レールはそのまま残す）。
         ・幹音だけにする：行が約半分になって密度が下がり、♯♭付きの2文字が出ない
         ・弦の真上に置くと弦（最大6幅）に文字が分断されるので、右へ9ずらす
         ・行間は off20 で26、off31 で14しかない。字は9で、これ以上大きくすると重なる
         ・濃さは板(--board)に対してコントラスト比 2.6:1。フレット番号(5.5:1)より
           はっきり下、ゾーン名(3.3:1)より薄い＝読めるが前に出てこない位置づけ */
      const pc = ((OPEN[i] + off) % 12 + 12) % 12;
      if(!NATURAL.has(pc)) return;
      parts.push(`<text x="${(x+9).toFixed(1)}" y="${(y+3.2).toFixed(1)}" fill="var(--faint)" opacity="0.6" font-size="9" text-anchor="start" font-family="var(--mono)">${NOTE_NAMES[pc]}</text>`);
    });
  }
  if(ST.frets) MARKERS.forEach(mk=>{
    if(!mk.r) return;
    const y=yOf(mk.off);
    parts.push(`<text x="${br+6}" y="${(y+3.5).toFixed(1)}" fill="var(--faint)" font-size="10" text-anchor="start" font-family="var(--mono)">${mk.r}</text>`);
  });

  parts.push(`<text x="${bx+4}" y="${((FB.topY+yLow)/2).toFixed(1)}" fill="var(--good)" font-size="10" opacity="0.5" font-family="var(--mono)">${tt('zone.low')}</text>`);
  parts.push(`<text x="${bx+4}" y="${((yLow+yMid)/2).toFixed(1)}" fill="var(--accent)" font-size="10" opacity="0.5" font-family="var(--mono)">${tt('zone.mid')}</text>`);
  parts.push(`<text x="${bx+4}" y="${((yMid+FB.botY)/2).toFixed(1)}" fill="var(--danger)" font-size="10" opacity="0.5" font-family="var(--mono)">${tt('zone.high')}</text>`);
  parts.push(`<rect x="${bx}" y="${FB.topY-9}" width="${bw}" height="6" fill="var(--wood)" rx="2"/>`);

  /* 弦：揺らせるように path で描く */
  FB.strX.forEach((x,i)=>{
    parts.push(`<path id="str${i}" class="strg" d="${straightPath(i)}" fill="none" stroke="var(--string)" stroke-width="${FB.strW[i]}" stroke-linecap="round" opacity="0.85"/>`);
    parts.push(`<circle id="rip${i}" class="rip" cx="${x}" cy="-99" r="15"/>`);
    parts.push(`<text x="${x}" y="${FB.topY-22}" fill="var(--muted)" font-size="14" text-anchor="middle" font-family="var(--mono)">${STRNAME[i]}</text>`);
    parts.push(`<text x="${x}" y="${FB.topY-36}" fill="var(--faint)" font-size="9" text-anchor="middle" font-family="var(--mono)">${midiName(OPEN[i])}</text>`);
  });

  parts.push(`<g id="notes"></g>`);
  for(let i=0;i<4;i++){
    parts.push(`<circle id="holddot${i}" cx="${FB.strX[i]}" cy="-99" r="13" fill="none" stroke="var(--alt)" stroke-width="3" opacity="0"/>`);
  }
  for(let i=0;i<4;i++){
    parts.push(`<circle id="tdot${i}" cx="${FB.strX[i]}" cy="-99" r="16" fill="var(--accent)" opacity="0"/>`);
    parts.push(`<text id="tlbl${i}" x="${FB.strX[i]}" y="-99" fill="#241a08" font-size="13" text-anchor="middle" font-weight="800" font-family="var(--mono)" opacity="0"></text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/* 音符ドットだけ描き替える（SVG全体を作り直さない＝メインスレッドを止めない） */
export function paintNotes(ev){
  const g=document.getElementById('notes');
  if(!g) return;
  if(!ev){ g.innerHTML=''; return; }
  const parts=[];
  const lead=ev.pitches[ev.leadIdx];
  const f=ev.fing;

  /* このイベントがスラーの中なら、群として扱う（同じ弦で結ぶ）。 */
  const grp = slurGroupOf(ev.id);
  const grpLeads = grp ? slurLeadMidis(grp) : null;

  /* 別の押さえ方の候補○。運指編集シートの札（optionsForAll）と同じ並びを出す＝
     シートに出ている候補は必ず指板にも○で見える。oct が付いているものは
     同じ音名で1・2オクターブ違う位置なので、破線＋薄めにして地の候補と分ける。
     スラーの中では、群の全音が同じ弦に収まる候補だけを出す（外れる弦を選べないように）。 */
  optionsForAll(lead.midi).forEach(o=>{
    if(f && o.str===f.str && o.off===f.off) return;   /* いま選ばれている位置には出さない */
    if(grp){
      const fit = grpLeads.every(m=>{ const off=(m+o.oct)-OPEN[o.str]; return off>=0 && off<=FB.maxOff; });
      if(!fit) return;                                 /* この弦では群が同じ弦に乗らない＝出さない */
    }
    const x=FB.strX[o.str], y=yOf(o.off);
    const dash = o.oct ? ' stroke-dasharray="3 3" opacity="0.65"' : '';
    parts.push(`<circle class="opt" data-str="${o.str}" data-oct="${o.oct}" cx="${x}" cy="${y.toFixed(1)}" r="12" fill="transparent" stroke="var(--alt)" stroke-width="2"${dash}/>`);
  });

  /* スラーの帯：群の各音が同じ弦なら、弦に沿って縦の帯で結び、中央に slur と書く。
     地の音符○より下（先）に描いて、○が帯の上に乗るようにする。 */
  if(grp){
    const mem=[];
    for(let i=grp[0]; i<=grp[1]; i++){ const m=ST.events[i]; if(m && m.fing) mem.push({id:i, str:m.fing.str, off:m.fing.off, name:m.pitches[m.leadIdx].name}); }
    if(mem.length>=2 && mem.every(mm=> mm.str===mem[0].str)){
      const x=FB.strX[mem[0].str];
      const ys=mem.map(mm=> yOf(mm.off));
      const yTop=Math.min.apply(null,ys), yBot=Math.max.apply(null,ys);
      const halfW=15, pad=17;
      const ry=Math.max(yTop-pad, FB.topY-4);
      const rh=(yBot+pad)-ry;
      parts.push(`<rect class="slurband" x="${(x-halfW).toFixed(1)}" y="${ry.toFixed(1)}" width="${(halfW*2).toFixed(1)}" height="${rh.toFixed(1)}" rx="${halfW.toFixed(1)}"/>`);
      const yc=(Math.max(yTop,ry)+yBot)/2;
      parts.push(`<text class="slurlbl" x="${x.toFixed(1)}" y="${(yc+3.5).toFixed(1)}">slur</text>`);
    }
    /* 群の主音のうち、いま鳴っている音以外も点灯させる（通常は1つ→スラーでは2つ以上）。 */
    for(const mm of mem){
      if(mm.id===ev.id) continue;
      const x=FB.strX[mm.str], y=yOf(mm.off);
      const open=(mm.off===0), col=open?'var(--open)':'var(--accent-dim)';
      parts.push(`<circle cx="${x}" cy="${y.toFixed(1)}" r="12" fill="${col}" opacity="0.92"/>`);
      parts.push(`<text x="${x}" y="${(y+26).toFixed(1)}" fill="${col}" font-size="11" text-anchor="middle" font-family="var(--mono)">${mm.name}</text>`);
    }
  }

  ev.pitches.forEach((p,idx)=>{
    if(idx===ev.leadIdx) return;
    const r=recommend(p.midi); if(!r) return;
    const x=FB.strX[r.str], y=yOf(r.off);
    const co=(r.off===0)?'var(--open)':'var(--accent-dim)';   /* 開放弦は水色 */
    parts.push(`<circle cx="${x}" cy="${y.toFixed(1)}" r="11" fill="${co}" opacity="0.9"/>`);
    parts.push(`<text x="${x}" y="${(y+3.8).toFixed(1)}" fill="#241a08" font-size="11" text-anchor="middle" font-weight="700" font-family="var(--mono)">${r.finger ?? ''}</text>`);
  });
  if(f){
    const x=FB.strX[f.str], y=yOf(f.off);
    const open=(f.off===0), col=open?'var(--open)':'var(--accent)';   /* 開放弦は水色（押さえない印） */
    parts.push(`<circle cx="${x}" cy="${y.toFixed(1)}" r="15" fill="${col}"/>`);
    parts.push(`<text x="${x}" y="${(y+5).toFixed(1)}" fill="#241a08" font-size="13" text-anchor="middle" font-weight="800" font-family="var(--mono)">${f.finger ?? ''}</text>`);
    parts.push(`<text x="${x}" y="${(y+31).toFixed(1)}" fill="${col}" font-size="12" text-anchor="middle" font-family="var(--mono)">${lead.name}</text>`);
  }
  g.innerHTML=parts.join('');
}

/* 署名が変わった時だけ指板を作り直す */
export let fbSig='';
export function renderBoard(ev){
  const box=document.getElementById('fbsvg');
  if(!box) return;
  const sig=[ST.frets, FB.maxOff, ST.mode].join('|');
  if(sig!==fbSig || !box.querySelector('svg')){
    fbSig=sig;
    box.innerHTML=drawBoardStatic();
    applyZoom();
  }
  paintNotes(ev);
}

/* ===== 弦の振動（減衰つき）＋波紋 ===== */
export function straightPath(i){
  const x=FB.strX[i];
  return `M${x},${(FB.topY-9).toFixed(1)} L${x},${FB.botY.toFixed(1)}`;
}
export function vibPath(i, off, amp, phase){
  const x=FB.strX[i];
  const y0=FB.topY-9, y1=FB.botY;
  const yf=Math.max(y0, yOf(off));
  const N=20;
  let d=`M${x},${y0.toFixed(1)}`;
  for(let k=1;k<=N;k++){
    const y=y0+(y1-y0)*k/N;
    let dx=0;
    if(y>yf){
      const u=(y-yf)/Math.max(1,(y1-yf));
      dx=amp*Math.sin(Math.PI*u)*Math.sin(phase);
    }
    d+=` L${(x+dx).toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}
export function pluckString(str, off, vel){
  if(str<0 || str>3) return;
  ST.vib[str]={t0:performance.now(), off, amp:4.5*(vel||1)};
  const rp=document.getElementById('rip'+str);
  if(rp){
    rp.setAttribute('cy', yOf(off).toFixed(1));
    rp.classList.remove('go'); void rp.getBoundingClientRect(); rp.classList.add('go');
  }
  if(!ST.vibRaf) ST.vibRaf=requestAnimationFrame(vibLoop);
}
export function pluckEvent(ev){
  if(!ev) return;
  if(ev.fing) pluckString(ev.fing.str, ev.fing.off, 1);
  ev.pitches.forEach((p,i)=>{
    if(i===ev.leadIdx) return;
    const r=recommend(p.midi);
    if(r) pluckString(r.str, r.off, 0.65);
  });
}
/* ドロワーの ‹ › で音を1つ試聴する（item5）。指板タップと同じ発音源（holdStart/holdStop）を
   使い、短く鳴らして自動で止める。再生スケジューラとは独立しているので停止中でも鳴らせる。
   ※ holdStart/holdStop はこの下で宣言しているが、関数宣言なので巻き上げで呼べる。 */
export function chirpEvent(ev, ms){
  if(!ev || !ev.pitches || !ev.pitches.length) return;
  pluckEvent(ev);                                   /* 弦の揺れ（見た目） */
  const dur=ms||430, used=new Set();
  const one=(str,midi)=>{ if(str<0||str>3||used.has(str)) return; used.add(str); holdStart(str,midi); setTimeout(()=>holdStop(str), dur); };
  const lead=ev.pitches[ev.leadIdx];
  if(ev.fing) one(ev.fing.str, lead.midi);
  else { const r=recommend(lead.midi); if(r) one(r.str, lead.midi); }
  ev.pitches.forEach((p,i)=>{ if(i===ev.leadIdx) return; const r=recommend(p.midi); if(r) one(r.str, p.midi); });
}
export function vibLoop(){
  const now=performance.now();
  let alive=false;
  for(let i=0;i<4;i++){
    const el=document.getElementById('str'+i);
    if(!el) continue;
    const v=ST.vib[i];
    if(!v) continue;
    const dt=(now-v.t0)/1000;
    const a=v.amp*Math.exp(-dt*2.6);
    if(a<0.3 || dt>4){ ST.vib[i]=null; el.setAttribute('d', straightPath(i)); el.style.filter=''; continue; }
    alive=true;
    el.setAttribute('d', vibPath(i, v.off, a, dt*2*Math.PI*16));
    el.style.filter=`drop-shadow(0 0 ${(a*0.8).toFixed(1)}px rgba(231,178,75,${Math.min(0.9,a/6).toFixed(2)}))`;
  }
  ST.vibRaf = alive ? requestAnimationFrame(vibLoop) : 0;
}

/* ===== アクティブ音までスクロール ===== */
/* force=true のときは「同じ音だからもう動かさない」の判定を飛ばす。
   運指編集で弦やポジションを変えたときは、音は同じままオレンジ●だけが
   遠くへ移るので、飛ばさないと画面の外に出たままになる。 */
export function scrollBoardToActive(force){
  const wrap=document.querySelector('.board-full');
  const svg=document.querySelector('#fbsvg svg');
  if(!wrap || !svg) return;
  const id = (ST.current!=null) ? ST.current : ST.selected;
  if(id==null) return;
  const ev=ST.events[id];
  if(!ev || !ev.fing) return;
  if(!force && ST.lastScrollId===id) return;
  ST.lastScrollId=id;
  const h=svg.getBoundingClientRect().height;
  if(!h) return;
  /* 運指編集シートが開いているあいだは画面の下半分がシートで隠れる。
     まん中（0.45）に寄せると●がシートの裏に入るので、上寄りに置く。 */
  const sheet=document.getElementById('editSheet');
  const ratio=(sheet && sheet.classList.contains('open')) ? 0.22 : 0.45;
  const yPx = yOf(ev.fing.off) * (h/FB.vbH);
  const target = yPx - wrap.clientHeight*ratio;
  wrap.scrollTo({top: Math.max(0, target), behavior:'smooth'});
}

/* ===== 指板ズーム ===== */
export const ZOOM_MIN=0.2, ZOOM_MAX=2.2;
export function baseBoardWidth(){
  const wrap=document.querySelector('.board-full');
  if(!wrap || !wrap.clientWidth) return 360;
  return Math.min(wrap.clientWidth - 12, 520);
}
export function applyZoom(){
  const box=document.getElementById('fbsvg');
  if(!box) return;
  ST.zoom=Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, ST.zoom));
  box.style.width=(baseBoardWidth()*ST.zoom).toFixed(0)+'px';
  box.style.maxWidth='none';
  document.body.classList.toggle('zoomed', ST.zoom>1.001);
  centerBoardH();
  const sl=document.getElementById('zoom');
  const lb=document.getElementById('zoomval');
  if(sl) sl.value=Math.round(ST.zoom*100);
  if(lb) lb.textContent=Math.round(ST.zoom*100)+'%';
  const rw=document.getElementById('zoomRowV');       /* 歯車の一覧に出す要約 */
  if(rw) rw.textContent=Math.round(ST.zoom*100)+'%';
}
/* 指板を横方向の中央に固定する。
   ズームで指板が画面幅を超えると横スクロールできてしまい、押弦のつもりの指で
   左右に流れて位置がずれる。CSS 側で touch-action:pan-y にして指では動かせなくし、
   はみ出したぶんはここで常に中央に置く（左右の余白が同じ＝弦の並びが常に真ん中）。 */
export function centerBoardH(){
  const wrap=document.querySelector('.board-full');
  if(!wrap) return;
  const over=wrap.scrollWidth - wrap.clientWidth;
  wrap.scrollLeft = (over>0) ? over/2 : 0;
}

/* 0〜5F（半音0〜5）が画面に収まる倍率にする */
export function zoomFitPositions(maxOff){
  const wrap=document.querySelector('.board-full');
  if(!wrap || !wrap.clientHeight) return;
  const cs=getComputedStyle(wrap);
  const availH=wrap.clientHeight - parseFloat(cs.paddingTop||0) - parseFloat(cs.paddingBottom||0);
  const needVb=yOf(maxOff) + 50;                 /* 音名ラベルぶんの余白 */
  ST.zoom=(availH * FB.vbW / needVb) / baseBoardWidth();
  applyZoom();
  wrap.scrollTo({top:0});                     /* left は指定しない＝applyZoom の中央寄せを保つ */
}
/* 指板全体が画面に収まる倍率にする */
export function zoomFit(){
  const wrap=document.querySelector('.board-full');
  if(!wrap || !wrap.clientHeight) return;
  const cs=getComputedStyle(wrap);
  const availH=wrap.clientHeight - parseFloat(cs.paddingTop||0) - parseFloat(cs.paddingBottom||0);
  const aspect=FB.vbH / FB.vbW;                /* 高さ / 幅 */
  const needW=availH / aspect;                 /* 収めるのに必要なSVG幅 */
  ST.zoom=needW / baseBoardWidth();
  applyZoom();
  wrap.scrollTo({top:0, behavior:'smooth'});  /* left は指定しない＝applyZoom の中央寄せを保つ */
  toast(tt('msg.zoom_fit', Math.round(ST.zoom*100)));
}


/* ===== 弦タップ発音（押している間だけ鳴る）＋ タップ座標 — 元 L3155–3227 ===== */
/* 発音は弦ごとに独立させる。ブリッジ側優先（＝off が大きい指を鳴らす）は
   「同じ弦の中」での話で、別の弦を押さえたらその弦も同時に鳴る。 */
export let liveCtx=null, liveOut=null;
export const liveVoices=[null,null,null,null];    /* 弦index -> {o1,o2,g} */
export function ensureLiveCtx(){
  if(!liveCtx){
    const AC=window.AudioContext||window.webkitAudioContext;
    liveCtx=new AC();
  }
  if(!liveOut){
    /* 再生側（audio/context.js）と同じ底上げ。指板タップだけ音が小さいのを揃える */
    const lim=makeLimiter(liveCtx); lim.connect(liveCtx.destination);
    liveOut=liveCtx.createGain(); liveOut.gain.value=MASTER_BOOST; liveOut.connect(lim);
  }
  if(liveCtx.state==='suspended'){ try{ liveCtx.resume(); }catch(e){} }
  return liveCtx;
}
export function holdActive(str){ return !!liveVoices[str]; }
export function holdStart(str, midi){
  if(str<0 || str>3) return;
  const ctx=ensureLiveCtx();
  holdStop(str);
  const f=midiFreq(midi), t=ctx.currentTime;
  const o1=ctx.createOscillator(); o1.type='sawtooth'; o1.frequency.value=f;
  const o2=ctx.createOscillator(); o2.type='triangle'; o2.frequency.value=f; o2.detune.value=-6;
  const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=Math.min(4200,f*6); lp.Q.value=0.6;
  const g=ctx.createGain();
  g.gain.setValueAtTime(0.0001,t);
  g.gain.linearRampToValueAtTime(0.20,t+0.03);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(liveOut);
  o1.start(t); o2.start(t);
  liveVoices[str]={o1,o2,g};
}
export function holdUpdate(str, midi){
  const v=liveVoices[str];
  if(!v || !liveCtx) return;
  const f=midiFreq(midi), t=liveCtx.currentTime;
  v.o1.frequency.setTargetAtTime(f,t,0.008);
  v.o2.frequency.setTargetAtTime(f,t,0.008);
}
export function holdStop(str){
  const v=liveVoices[str];
  if(!v || !liveCtx) return;
  liveVoices[str]=null;
  const t=liveCtx.currentTime;
  const {o1,o2,g}=v;
  try{
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0.0001, t+0.06);
  }catch(e){}
  setTimeout(()=>{ try{o1.stop(); o2.stop();}catch(e){} }, 160);
}
export function holdStopAll(){ for(let i=0;i<4;i++) holdStop(i); }
/* 画面座標 → 弦・半音 */
export function pointToPos(evt){
  const svg=document.querySelector('#fbsvg svg');
  if(!svg || !svg.getScreenCTM) return null;
  const ctm=svg.getScreenCTM(); if(!ctm) return null;
  const pt=svg.createSVGPoint();
  pt.x=evt.clientX; pt.y=evt.clientY;
  const p=pt.matrixTransform(ctm.inverse());
  let si=0, best=1e9;
  FB.strX.forEach((x,i)=>{ const d=Math.abs(p.x-x); if(d<best){ best=d; si=i; } });
  if(best>34) return null;
  let off=Math.round(offOfY(p.y));
  off=Math.max(0, Math.min(FB.maxOff, off));
  return {str:si, off, midi:OPEN[si]+off};
}
export function showHoldDot(pos){
  const dot=document.getElementById('holddot'+pos.str);
  if(!dot) return;
  dot.setAttribute('cx', FB.strX[pos.str]);
  dot.setAttribute('cy', yOf(pos.off).toFixed(1));
  dot.setAttribute('opacity', '0.95');
  const z=zoneOf(pos.off);
  setNowLine(`<b>${midiName(pos.midi)}</b> · ${strFingerText(pos.str, pos.off)} · ${z.zone}`, true);
}
export function hideHoldDot(str){
  if(str==null){
    for(let i=0;i<4;i++){ const d=document.getElementById('holddot'+i); if(d) d.setAttribute('opacity','0'); }
  }else{
    const d=document.getElementById('holddot'+str);
    if(d) d.setAttribute('opacity','0');
  }
  if(liveVoices.some(v=>v)) return;        /* まだ鳴っている弦があれば上部表示は戻さない */
  const id=(ST.current!=null)?ST.current:ST.selected;
  renderNow(id!=null ? ST.events[id] : null);
}
