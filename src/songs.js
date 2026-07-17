/*
  songs.js — 譜面パース・トラック管理・曲/サンプル読み込み。
  元 cello-finger.html より無改変で移植。
    pitchToMidi/parseMusicXML                 … L1062–1156
    parseMidi/bestTrackIndex/midiTrackToEvents（SMFパーサ）… L2016–2185
    readAsText/unMxl（.mxl解凍。JSZipはグローバル）… L2738–2748
    midiFile/renderTracks/selectTrack/firstNoteBeat/skipToStart/loadScoreFile … L2832–2919
    SAMPLE_XML/loadSample/buildSongKirakira/SONGS/loadSong … L2948–3124
  依存: state(ST), util(midiName), fingerboard(recommend/scrollBoardToActive),
        notation(scrollStaffToActive), scale(buildScaleEvents),
        scheduler(measureOfBeat/setSeekHead/setTempo/startPlay/updateTransport),
        modes(render/scrollStripToActive/setScore/syncLoopUI), drawer(closeDrawer/openDrawer/openPdfOverlay),
        dom(toast), pdf(openPdf)。JSZip は index.html でグローバル読み込み。
  ※ pdf は Batch7 で作成。それまで PDFファイルを開く経路のみ実行時未解決。
*/
import { ST } from './state.js';
import { midiName } from './util.js';
import { recommend, scrollBoardToActive } from './fingerboard.js';
import { scrollStaffToActive } from './notation.js';
import { buildScaleEvents } from './scale.js';
import { measureOfBeat, setSeekHead, setTempo, startPlay, updateTransport } from './audio/scheduler.js';
import { render, scrollStripToActive, setScore, syncLoopUI } from './modes.js';
import { closeDrawer, openDrawer, openPdfOverlay } from './drawer.js';
import { toast } from './dom.js';
import { openPdf } from './pdf.js';

export function pitchToMidi(pEl){
  const step = pEl.querySelector('step').textContent.trim();
  const oct  = parseInt(pEl.querySelector('octave').textContent,10);
  const altEl= pEl.querySelector('alter');
  const alter= altEl ? parseInt(altEl.textContent,10) : 0;
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step];
  return (oct+1)*12 + base + alter;
}

export function parseMusicXML(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if(doc.querySelector('parsererror')) throw new Error('XMLを解析できませんでした。ファイルが壊れている可能性があります。');
  if(!doc.querySelector('score-partwise')){
    if(doc.querySelector('score-timewise')) throw new Error('score-timewise 形式は未対応です。partwise形式で書き出してください。');
    throw new Error('MusicXMLとして認識できませんでした。');
  }
  const part = doc.querySelector('score-partwise > part');
  if(!part) throw new Error('パート（part）が見つかりませんでした。');

  /* テンポ */
  let tempo = ST.tempo;
  const sTempo = doc.querySelector('sound[tempo]');
  if(sTempo) tempo = parseFloat(sTempo.getAttribute('tempo'));
  else { const pm = doc.querySelector('metronome per-minute'); if(pm) tempo = parseFloat(pm.textContent); }

  /* 拍子（4分音符=1拍 換算の1小節の長さ） */
  let beatsPerMeasure = 4;
  const timeEl = doc.querySelector('time');
  if(timeEl){
    const bEl = timeEl.querySelector('beats'), tEl = timeEl.querySelector('beat-type');
    if(bEl && tEl){
      const b = parseInt(bEl.textContent,10), bt = parseInt(tEl.textContent,10);
      if(b>0 && bt>0) beatsPerMeasure = b * (4/bt);
    }
  }

  let divisions = 1, cursor = 0, lastOnset = 0;
  const raw = [];
  const mList = [];
  const measures = part.querySelectorAll(':scope > measure');
  measures.forEach((m, mi)=>{
    const mStart = cursor;
    let mMax = cursor;
    for(const node of m.children){
      const tag = node.tagName;
      if(tag === 'attributes'){
        const d = node.querySelector('divisions');
        if(d) divisions = parseInt(d.textContent,10) || divisions;
      } else if(tag === 'note'){
        const durEl = node.querySelector('duration');
        const dur = durEl ? (parseInt(durEl.textContent,10)/divisions) : 0;
        const isChord = !!node.querySelector('chord');
        const isRest  = !!node.querySelector('rest');
        const onset = isChord ? lastOnset : cursor;
        if(!isRest){
          const pEl = node.querySelector('pitch');
          if(pEl) raw.push({onset, dur, midi:pitchToMidi(pEl), measure:mi+1});
        }
        if(!isChord){ cursor += dur; lastOnset = onset; }
        if(cursor > mMax) mMax = cursor;
      } else if(tag === 'backup'){
        const d = node.querySelector('duration');
        if(d) cursor -= parseInt(d.textContent,10)/divisions;
      } else if(tag === 'forward'){
        const d = node.querySelector('duration');
        if(d) cursor += parseInt(d.textContent,10)/divisions;
        if(cursor > mMax) mMax = cursor;
      }
    }
    /* 多声部で backup が残っていても、小節末尾に揃える */
    const mEnd = Math.max(mMax, mStart + beatsPerMeasure);
    cursor = mEnd;
    mList.push({num: mi+1, start: mStart, end: mEnd});
  });

  /* 同時刻の音をまとめて和音イベント化 */
  raw.sort((a,b)=> a.onset-b.onset);
  const map = new Map();
  for(const r of raw){
    const key = Math.round(r.onset*1000)/1000;
    if(!map.has(key)) map.set(key, {onset:key, measure:r.measure, midis:new Set(), dur:0});
    const g = map.get(key);
    g.midis.add(r.midi);
    g.dur = Math.max(g.dur, r.dur);
  }
  const evs = [...map.values()].sort((a,b)=> a.onset-b.onset).map((g,i)=>{
    const pitches = [...g.midis].sort((x,y)=>x-y).map(m=>({midi:m, name:midiName(m)}));
    const leadIdx = pitches.length-1;
    return {id:i, measure:g.measure, onset:g.onset, dur:(g.dur>0?g.dur:0.5), pitches, leadIdx, fing:null};
  });
  evs.forEach(e=>{ e.fing = recommend(e.pitches[e.leadIdx].midi); });

  if(!evs.length) throw new Error('音符が見つかりませんでした。');
  return {events:evs, tempo, measures:mList, beatsPerMeasure};
}

export function parseMidi(buf){
  const dv=new DataView(buf);
  let p=0;
  const tag=(n)=>{ let s=''; for(let i=0;i<n;i++) s+=String.fromCharCode(dv.getUint8(p++)); return s; };
  if(dv.byteLength<14 || tag(4)!=='MThd') throw new Error('MIDIファイルとして認識できません。');
  const hlen=dv.getUint32(p); p+=4;
  p+=2;                                  /* format */
  const ntrk=dv.getUint16(p); p+=2;
  const division=dv.getUint16(p); p+=2;
  p += Math.max(0, hlen-6);
  if(division & 0x8000) throw new Error('SMPTE形式のMIDIは未対応です。');

  let tempo=120, tempoSet=false, tsNum=4, tsDen=4;
  const tracks=[];

  for(let t=0; t<ntrk && p+8<=dv.byteLength; t++){
    const id=tag(4);
    const len=dv.getUint32(p); p+=4;
    const end=Math.min(p+len, dv.byteLength);
    if(id!=='MTrk'){ p=end; continue; }

    let tick=0, running=0, name='';
    const pending={};
    const notes=[];
    const prog={};

    while(p<end){
      let v=0,b;
      do{ b=dv.getUint8(p++); v=(v<<7)|(b&0x7f); }while((b&0x80) && p<end);
      tick+=v;
      if(p>=end) break;

      let status=dv.getUint8(p);
      if(status & 0x80){ p++; running=status; } else { status=running; }
      const type=status & 0xf0, ch=status & 0x0f;

      if(status===0xff){
        const meta=dv.getUint8(p++);
        let ln=0,bb;
        do{ bb=dv.getUint8(p++); ln=(ln<<7)|(bb&0x7f); }while((bb&0x80) && p<end);
        if(meta===0x03 && ln>0){
          let s=''; for(let i=0;i<ln && p+i<end;i++) s+=String.fromCharCode(dv.getUint8(p+i));
          name=s.replace(/[^\x20-\x7e\u3000-\u9fff\uff00-\uffef]/g,'').trim();
        } else if(meta===0x51 && ln===3 && !tempoSet){
          const us=(dv.getUint8(p)<<16)|(dv.getUint8(p+1)<<8)|dv.getUint8(p+2);
          if(us>0){ tempo=Math.round(60000000/us); tempoSet=true; }
        } else if(meta===0x58 && ln>=2){
          tsNum=dv.getUint8(p) || 4;
          tsDen=Math.pow(2, dv.getUint8(p+1)) || 4;
        }
        p+=ln;
      } else if(status===0xf0 || status===0xf7){
        let ln=0,bb;
        do{ bb=dv.getUint8(p++); ln=(ln<<7)|(bb&0x7f); }while((bb&0x80) && p<end);
        p+=ln;
      } else if(type===0x80 || type===0x90){
        const note=dv.getUint8(p++), vel=dv.getUint8(p++);
        const key=note+'_'+ch;
        if(type===0x90 && vel>0){
          (pending[key]=pending[key]||[]).push(tick);
        } else {
          const arr=pending[key];
          if(arr && arr.length){
            const st=arr.shift();
            if(tick>st) notes.push({startTick:st, endTick:tick, midi:note, ch});
          }
        }
      } else if(type===0xa0 || type===0xb0 || type===0xe0){
        p+=2;
      } else if(type===0xc0){
        if(!(ch in prog)) prog[ch]=dv.getUint8(p);
        p+=1;
      } else if(type===0xd0){
        p+=1;
      } else {
        p++;
      }
    }
    p=end;
    if(notes.length){
      /* チャンネルごとに分割（Format 0 や複数パートが1トラックに入る場合に対応） */
      const byCh=new Map();
      for(const n of notes){
        if(!byCh.has(n.ch)) byCh.set(n.ch, []);
        byCh.get(n.ch).push(n);
      }
      const multi = byCh.size > 1;
      const chans=[...byCh.keys()].sort((a,b)=>a-b);
      for(const ch of chans){
        const ns=byCh.get(ch);
        ns.sort((a,b)=> a.startTick-b.startTick);
        let lo=127, hi=0;
        for(const n of ns){ if(n.midi<lo) lo=n.midi; if(n.midi>hi) hi=n.midi; }
        const drum = (ch===9);
        let label = name || `トラック ${t+1}`;
        if(multi || drum) label += ` [ch${ch+1}]`;
        if(drum) label += ' 🥁';
        tracks.push({
          index:tracks.length, name:label, notes:ns, count:ns.length,
          ch, prog:(ch in prog ? prog[ch] : -1), lo, hi, drum
        });
      }
    }
  }
  if(!tracks.length) throw new Error('音符のあるトラックが見つかりませんでした。');
  return {tracks, tempo, tsNum, tsDen, division};
}

/* 主旋律らしいトラックを既定選択にする
   （音数だけだと伴奏＝ハープ等が勝ってしまうので、単旋律らしさと楽器名も見る） */
export const MELODY_RE = /(cello|violoncello|\bvc\b|violin|viola|solo|melody|lead|chero|チェロ|バイオリン|ヴァイオリン|主旋律|旋律|メロディ)/i;
export function bestTrackIndex(tracks){
  let best=0, bestScore=-1;
  tracks.forEach((t,i)=>{
    if(t.drum) return;
    let inRange=0;
    for(const n of t.notes){ if(n.midi>=OPEN[0] && n.midi<=OPEN[3]+FB.maxOff) inRange++; }
    if(!inRange) return;
    /* 単旋律らしさ＝前の音と重ならない割合（伴奏・和音トラックは低くなる） */
    let mono=0;
    for(let k=1;k<t.notes.length;k++){
      if(t.notes[k].startTick >= t.notes[k-1].endTick - 1) mono++;
    }
    const monoRate = (t.notes.length>1) ? mono/(t.notes.length-1) : 1;
    let score = inRange * (0.25 + 0.75*monoRate);
    if(MELODY_RE.test(t.name)) score += 1e6;       /* 旋律楽器の名前なら最優先 */
    if(score > bestScore){ bestScore=score; best=i; }
  });
  return bestScore>0 ? best : 0;
}

/* MIDIトラック → イベント列 */
export function midiTrackToEvents(track, division, tsNum, tsDen){
  const beatsPerMeasure = (tsNum * (4/tsDen)) || 4;
  const raw = track.notes.map(n=>({
    onset: n.startTick/division,
    dur: Math.max((n.endTick-n.startTick)/division, 0.06),
    midi: n.midi
  })).sort((a,b)=> a.onset-b.onset);

  /* 同時発音（誤差0.03拍以内）を和音としてまとめる */
  const groups=[];
  for(const r of raw){
    const g=groups[groups.length-1];
    if(g && Math.abs(r.onset-g.onset)<0.03){
      g.midis.add(r.midi);
      g.dur=Math.max(g.dur, r.dur);
    } else {
      groups.push({onset:r.onset, midis:new Set([r.midi]), dur:r.dur});
    }
  }

  const evs=groups.map((g,i)=>{
    const pitches=[...g.midis].sort((x,y)=>x-y).map(m=>({midi:m, name:midiName(m)}));
    return {
      id:i,
      measure: Math.floor(g.onset/beatsPerMeasure)+1,
      onset:g.onset, dur:g.dur,
      pitches, leadIdx:pitches.length-1, fing:null
    };
  });
  evs.forEach(e=>{ e.fing = recommend(e.pitches[e.leadIdx].midi); });

  const last=evs.length ? evs[evs.length-1] : null;
  const maxM = last ? Math.max(1, Math.ceil((last.onset+last.dur)/beatsPerMeasure)) : 1;
  const measures=[];
  for(let m=1;m<=maxM;m++) measures.push({num:m, start:(m-1)*beatsPerMeasure, end:m*beatsPerMeasure});

  return {events:evs, measures, beatsPerMeasure};
}

export async function readAsText(file){ return await file.text(); }
export async function unMxl(file){
  if(window.__noZip || !window.JSZip) throw new Error('.mxl の展開に必要なライブラリを読み込めませんでした。オフライン時は .xml / .musicxml で保存してください。');
  const zip=await JSZip.loadAsync(file);
  let target=null;
  const container=zip.file('META-INF/container.xml');
  if(container){ const c=await container.async('string'); const m=c.match(/full-path="([^"]+)"/); if(m) target=m[1]; }
  if(!target){ target=Object.keys(zip.files).find(n=>/\.xml$/i.test(n) && !/^META-INF/i.test(n)); }
  if(!target || !zip.file(target)) throw new Error('.mxl 内にMusicXMLが見つかりませんでした。');
  return await zip.file(target).async('string');
}

export let midiFile=null;
export function renderTracks(){
  const box=document.getElementById('tracks');
  const list=document.getElementById('trackList');
  if(!midiFile){ box.classList.remove('show'); list.innerHTML=''; return; }
  box.classList.add('show');
  list.innerHTML = midiFile.tracks.map((t,i)=>{
    const range = `${midiName(t.lo)}–${midiName(t.hi)}`;
    return `<div class="trow${i===midiFile.sel?' on':''}" data-i="${i}">`
      + `<span class="tn">${t.name}<small>${range}</small></span>`
      + `<span class="tc">${t.count}音</span></div>`;
  }).join('');
}
export function selectTrack(i, play){
  if(!midiFile || !midiFile.tracks[i]) return;
  midiFile.sel=i;
  const t=midiFile.tracks[i];
  const parsed=midiTrackToEvents(t, midiFile.division, midiFile.tsNum, midiFile.tsDen);
  setTempo(Math.round(midiFile.tempo));
  setScore(parsed, midiFile.name+'#'+i);
  renderTracks();
  const out=parsed.events.filter(e=> !e.fing).length;
  toast(`${t.name}：${parsed.events.length}イベント` + (out ? ` / 音域外 ${out}` : ''));
  if(play && ST.events.length){
    /* トラック名タップ → 最初の音から試聴 */
    const first=firstNoteBeat();
    ST.playhead=first;
    setTimeout(()=> startPlay(first), 200);
  }
}
/* 最初に音が鳴る拍（MIDIは冒頭が休符のことがある） */
export function firstNoteBeat(){
  if(!ST.events.length) return 0;
  return ST.events[0].onset;
}
/* 最初の音へスキップ */
export function skipToStart(){
  if(!ST.events.length) return;
  const beat=firstNoteBeat();
  ST.playhead=beat;
  if(ST.playing){ startPlay(beat, true); }
  else{
    ST.selected=0; ST.current=null;
    render(); setSeekHead(beat);
    scrollBoardToActive(); scrollStripToActive();
    if(ST.view==='staff') scrollStaffToActive();
  }
  const m=measureOfBeat(beat);
  toast(`最初の音へ（第${m}小節 / ${ST.events[0].pitches[0].name}）`);
}

export async function loadScoreFile(file){
  const name=file.name.toLowerCase();
  if(name.endsWith('.pdf')){ closeDrawer(); openPdfOverlay(); return openPdf(file); }

  try{
    /* ---- MIDI ---- */
    if(name.endsWith('.mid') || name.endsWith('.midi')){
      const buf=await file.arrayBuffer();
      const m=parseMidi(buf);
      const sel=bestTrackIndex(m.tracks);
      midiFile={tracks:m.tracks, tempo:m.tempo, tsNum:m.tsNum, tsDen:m.tsDen, division:m.division, name:file.name, sel};
      selectTrack(sel);
      openDrawer();
      const box=document.getElementById('tracks');
      if(box.scrollIntoView) box.scrollIntoView({block:'nearest'});
      toast(`MIDI：${m.tracks.length}トラック → 一覧から選べます`);
      return;
    }

    /* ---- MusicXML ---- */
    midiFile=null; renderTracks();
    let text;
    if(name.endsWith('.mxl')){ text=await unMxl(file); }
    else{
      text=await readAsText(file);
      if(text.trimStart()[0] !== '<'){ text=await unMxl(file); } // zip実体だった場合
    }
    const parsed=parseMusicXML(text);
    setTempo(Math.round(parsed.tempo));
    const restored=setScore(parsed, file.name);
    closeDrawer();
    toast(`読み込み完了：${parsed.events.length}イベント${restored?' / 運指を復元':''}`);
  }catch(err){
    toast('読み込めません：'+err.message);
    console.error(err);
  }
}

export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list>
<part id="P1">
<measure number="1">
<attributes><divisions>4</divisions><key><fifths>1</fifths></key><time><beats>6</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><sound tempo="79"/>
<note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note>
</measure>
<measure number="2">
<note><pitch><step>A</step><octave>4</octave></pitch><duration>10</duration></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration></note>
<note><rest/><duration>4</duration></note>
</measure>
<measure number="3">
<note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration></note>
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration></note>
</measure>
<measure number="4">
<note><pitch><step>B</step><octave>5</octave></pitch><duration>14</duration></note>
<note><rest/><duration>10</duration></note>
</measure>
<measure number="5">
<note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note>
</measure>
<measure number="6">
<note><pitch><step>A</step><alter>1</alter><octave>4</octave></pitch><duration>10</duration></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>9</duration></note>
<note><rest/><duration>3</duration></note>
</measure>
<measure number="7">
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>6</duration></note>
<note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>A</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>G</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>A</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration></note>
</measure>
<measure number="8">
<note><pitch><step>D</step><octave>6</octave></pitch><duration>15</duration></note>
<note><rest/><duration>9</duration></note>
</measure>
<measure number="9">
<note><pitch><step>D</step><octave>6</octave></pitch><duration>4</duration></note>
<note><pitch><step>B</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration></note>
</measure>
<measure number="10">
<note><pitch><step>D</step><octave>5</octave></pitch><duration>10</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>8</duration></note>
<note><rest/><duration>4</duration></note>
</measure>
<measure number="11">
<note><pitch><step>C</step><octave>6</octave></pitch><duration>4</duration></note>
<note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration></note>
</measure>
<measure number="12">
<note><pitch><step>C</step><octave>5</octave></pitch><duration>10</duration></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration></note>
<note><rest/><duration>4</duration></note>
</measure>
<measure number="13">
<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration></note>
</measure>
<measure number="14">
<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>12</duration></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration></note>
<note><rest/><duration>4</duration></note>
</measure>
</part>
</score-partwise>`;

export function loadSample(quiet){
  try{
    midiFile=null; renderTracks();
    const parsed=parseMusicXML(SAMPLE_XML);
    setTempo(Math.round(parsed.tempo));
    setScore(parsed, 'le-cygne');
    if(!quiet){ closeDrawer(); toast('白鳥を読み込みました'); }
  }catch(e){ toast('プリセット読込エラー：'+e.message); }
}

/* ===== スケール生成（スケール練習モード） ===== */
export function genScale(quiet){
  try{
    midiFile=null; renderTracks();
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
      toast(`${label}（${parsed.events.length}音 / ${parsed.measures.length}小節）`);
      setTimeout(()=>{ if(ST.mode==='scale' && ST.events.length) startPlay(0); }, 260);  /* 生成したら自動再生 */
    }
  }catch(e){ toast('生成できません：'+e.message); }
}

/* ===== プリセット曲：キラキラ星（伝承・パブリックドメイン） ===== */
/* [midi, 拍数] の並び。4/4・ハ長調・2オクターブ内の主旋律 */
export function buildSongKirakira(){
  const seq=[
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2]
  ];
  const beatsPerMeasure=4;
  let onset=0;
  const evs=seq.map((it,i)=>{
    const p={midi:it[0], name:midiName(it[0])};
    const ev={id:i, measure:Math.floor(onset/beatsPerMeasure)+1, onset, dur:it[1], pitches:[p], leadIdx:0, fing:null};
    onset+=it[1];
    return ev;
  });
  evs.forEach(e=>{ e.fing=recommend(e.pitches[0].midi); });
  const maxM=Math.ceil(onset/beatsPerMeasure);
  const measures=[];
  for(let mm=1;mm<=maxM;mm++) measures.push({num:mm, start:(mm-1)*beatsPerMeasure, end:mm*beatsPerMeasure});
  return {events:evs, measures, beatsPerMeasure};
}
export const SONGS = {
  kirakira: {label:'キラキラ星', tempo:96, build:buildSongKirakira}
};
export function loadSong(id, quiet){
  const s=SONGS[id];
  if(!s){ toast('準備中です'); return; }
  try{
    midiFile=null; renderTracks();
    const parsed=s.build();
    setTempo(s.tempo);
    setScore(parsed, 'song:'+id);
    if(!quiet){ closeDrawer(); toast(s.label+'を読み込みました'); }
  }catch(e){ toast('読込エラー：'+e.message); }
}
