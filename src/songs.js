/*
  songs.js — 譜面パース・トラック管理・曲/サンプル読み込み。
  元 cello-finger.html より無改変で移植。
    pitchToMidi/parseMusicXML                 … L1062–1156
    parseMidi/bestTrackIndex/midiTrackToEvents（SMFパーサ）… L2016–2185
    readAsText/unMxl（.mxl解凍。JSZipはグローバル）… L2738–2748
    midiFile/renderTracks/selectTrack/firstNoteBeat/skipToStart/loadScoreFile … L2832–2919
    SAMPLE_XML/loadSample                     … L2948–3010
    SONGS/loadSong（元 L3088–3124）は public/songs/ の外部JSON読み込みに変更
      （loadSongManifest → renderSongList → loadSong で個別JSONを fetch）
  依存: state(ST), util(midiName), fingerboard(recommend/scrollBoardToActive),
        notation(scrollStaffToActive), scale(buildScaleEvents),
        scheduler(measureOfBeat/setSeekHead/setTempo/startPlay/updateTransport),
        modes(render/scrollStripToActive/setScore/syncLoopUI), drawer(closeDrawer/openDrawer/setScoreSub),
        dom(toast), uploads(beginUpload/rememberUpload)。JSZip は基幹PHPでグローバル読み込み。
  ※ PDFの参照表示・読み取り（OMR）は廃止した（.pdf は受け付けない）。
*/
import { ST } from './state.js';
import { midiName, NOTE_NAMES, OPEN, tt, pickText, localFile, localUrl } from './util.js';
import { recommend, scrollBoardToActive, FB } from './fingerboard.js';
import { scrollStaffToActive } from './notation.js';
import { buildScaleEvents, SCALE_LABEL } from './scale.js';
import { measureOfBeat, setSeekHead, setTempo, startPlay, updateTransport } from './audio/scheduler.js';
import { render, scrollStripToActive, setScore, syncDock, syncLoopUI } from './modes.js';
import { closeDrawer, openDrawer, setScoreSub } from './drawer.js';
import { toast } from './dom.js';
/* 読み込んだ譜面を保存番号に紐づけて残す（保存番号が無ければ何もしない） */
import { beginUpload, rememberUpload } from './uploads.js';

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
  if(doc.querySelector('parsererror')) throw new Error(tt('msg.xml_parse_fail'));
  if(!doc.querySelector('score-partwise')){
    if(doc.querySelector('score-timewise')) throw new Error(tt('msg.timewise_unsupported'));
    throw new Error(tt('msg.not_musicxml'));
  }
  const part = doc.querySelector('score-partwise > part');
  if(!part) throw new Error(tt('msg.no_part'));

  /* テンポ */
  let tempo = ST.tempo;
  const sTempo = doc.querySelector('sound[tempo]');
  if(sTempo) tempo = parseFloat(sTempo.getAttribute('tempo'));
  else { const pm = doc.querySelector('metronome per-minute'); if(pm) tempo = parseFloat(pm.textContent); }

  /* 拍子（4分音符=1拍 換算の1小節の長さ） */
  let beatsPerMeasure = 4, beatUnit = 1;
  const timeEl = doc.querySelector('time');
  if(timeEl){
    const bEl = timeEl.querySelector('beats'), tEl = timeEl.querySelector('beat-type');
    if(bEl && tEl){
      const b = parseInt(bEl.textContent,10), bt = parseInt(tEl.textContent,10);
      if(b>0 && bt>0){ beatsPerMeasure = b * (4/bt); beatUnit = beatUnitOf(b, bt); }
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

  if(!evs.length) throw new Error(tt('msg.no_notes'));
  return {events:evs, tempo, measures:mList, beatsPerMeasure, beatUnit};
}

/* MIDI のテキスト（トラック名など）には文字コードの指定が無い。
   UTF-8 として筋の通る並びなら UTF-8、そうでなければ日本語のSMFで多い Shift_JIS として読む。
   どちらでも読めないときだけ従来どおり1バイト＝1文字として扱う。
   ※ 以前は常に1バイト＝1文字（Latin-1）で読み、そのうえで日本語以外を捨てていたため、
      日本語のトラック名が文字化けしたり丸ごと消えたりしていた。 */
/* MIDIの中身を base64 にする／戻す。大きい配列でも積み上げないよう小分けにする */
export function bytesToBase64(bytes){
  let s='';
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step) s+=String.fromCharCode.apply(null, bytes.subarray(i, i+step));
  return btoa(s);
}
export function base64ToBytes(b64){
  const s=atob(b64), a=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++) a[i]=s.charCodeAt(i);
  return a;
}

export function decodeMidiText(bytes){
  const clean=(s)=> s.replace(/[\x00-\x1f\x7f]/g,'').trim();
  if(typeof TextDecoder==='function'){
    try{ return clean(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }catch(e){}
    try{
      const s=new TextDecoder('shift_jis').decode(bytes);
      if(s.indexOf('\ufffd')<0) return clean(s);
    }catch(e){}
  }
  let s='';
  for(let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
  return clean(s);
}

export function parseMidi(buf){
  const dv=new DataView(buf);
  let p=0;
  const tag=(n)=>{ let s=''; for(let i=0;i<n;i++) s+=String.fromCharCode(dv.getUint8(p++)); return s; };
  if(dv.byteLength<14 || tag(4)!=='MThd') throw new Error(tt('msg.not_midi'));
  const hlen=dv.getUint32(p); p+=4;
  p+=2;                                  /* format */
  const ntrk=dv.getUint16(p); p+=2;
  const division=dv.getUint16(p); p+=2;
  p += Math.max(0, hlen-6);
  if(division & 0x8000) throw new Error(tt('msg.smpte_unsupported'));

  let tempo=120, tempoSet=false, tsNum=4, tsDen=4, tsSet=false;
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
          const bytes=new Uint8Array(Math.max(0, Math.min(ln, end-p)));
          for(let i=0;i<bytes.length;i++) bytes[i]=dv.getUint8(p+i);
          name=decodeMidiText(bytes);
        } else if(meta===0x51 && ln===3 && !tempoSet){
          const us=(dv.getUint8(p)<<16)|(dv.getUint8(p+1)<<8)|dv.getUint8(p+2);
          if(us>0){ tempo=Math.round(60000000/us); tempoSet=true; }
        } else if(meta===0x58 && ln>=2 && !tsSet){
          /* 拍子は【最初のものだけ】採る。曲の途中で変わる譜面で最後の拍子を拾うと、
             小節の切り方とメトロノームが曲全体でずれる（テンポと同じ扱いにそろえた）。 */
          tsNum=dv.getUint8(p) || 4;
          tsDen=Math.pow(2, dv.getUint8(p+1)) || 4;
          tsSet=true;
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
        let label = name || tt('msg.track_n', t+1);
        if(multi || drum) label += ` [ch${ch+1}]`;
        if(drum) label += ' 🥁';
        tracks.push({
          index:tracks.length, name:label, notes:ns, count:ns.length,
          ch, prog:(ch in prog ? prog[ch] : -1), lo, hi, drum
        });
      }
    }
  }
  if(!tracks.length) throw new Error(tt('msg.no_track_with_notes'));
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

/* 拍子から「1拍の長さ」を出す（4分音符＝1）。メトロノームが刻む間隔になる。
     4/4・3/4 → 1（4分音符）
     6/8・9/8・12/8 → 1.5（付点4分音符。複合拍子は付点で数えるのが普通）
     3/8 → 0.5（8分音符）
     2/2 → 2（2分音符）
   これを渡さないと ST.beatUnit が 1 のままになり、8分の曲でメトロノームが合わない。 */
export function beatUnitOf(tsNum, tsDen){
  const num=tsNum || 4, den=tsDen || 4;
  if(den===8 && num>3 && num%3===0) return 1.5;
  return 4/den;
}

/* MIDIトラック → イベント列 */
export function midiTrackToEvents(track, division, tsNum, tsDen){
  const beatsPerMeasure = (tsNum * (4/tsDen)) || 4;
  const beatUnit = beatUnitOf(tsNum, tsDen);
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

  return {events:evs, measures, beatsPerMeasure, beatUnit};
}

export async function readAsText(file){ return await file.text(); }
export async function unMxl(file){
  if(window.__noZip || !window.JSZip) throw new Error(tt('msg.mxl_lib_fail'));
  const zip=await JSZip.loadAsync(file);
  let target=null;
  const container=zip.file('META-INF/container.xml');
  if(container){ const c=await container.async('string'); const m=c.match(/full-path="([^"]+)"/); if(m) target=m[1]; }
  if(!target){ target=Object.keys(zip.files).find(n=>/\.xml$/i.test(n) && !/^META-INF/i.test(n)); }
  if(!target || !zip.file(target)) throw new Error(tt('msg.mxl_no_xml'));
  return await zip.file(target).async('string');
}

export let midiFile=null;
export function setMidiFile(v){ midiFile=v; }  /* 分割対応: 外部モジュールからの代入用 */
export function renderTracks(){
  const box=document.getElementById('tracks');
  const list=document.getElementById('trackList');
  if(!midiFile){ box.classList.remove('show'); list.innerHTML=''; return; }
  box.classList.add('show');
  list.innerHTML = midiFile.tracks.map((t,i)=>{
    const range = `${midiName(t.lo)}–${midiName(t.hi)}`;
    return `<div class="trow${i===midiFile.sel?' on':''}" data-i="${i}">`
      + `<span class="tn">${t.name}<small>${range}</small></span>`
      + `<span class="tc">${tt('msg.track_count', t.count)}</span></div>`;
  }).join('');
}
export function selectTrack(i, play){
  if(!midiFile || !midiFile.tracks[i]) return;
  midiFile.sel=i;
  const t=midiFile.tracks[i];
  const parsed=midiTrackToEvents(t, midiFile.division, midiFile.tsNum, midiFile.tsDen);
  setTempo(Math.round(midiFile.tempo));
  setScore(parsed, midiFile.name+'#'+i, midiFile.name+' / '+t.name);
  /* 選んだトラックを保存番号に紐づけて残す（自動選択ぶんもここを通るので、
     loadScoreFile 側では呼ばない＝二重に保存しない）。
     一覧に出す名前はファイル名だけにして、選んだトラックは副題として持たせる
     ＝トラックを選び直しても件数は増えず、同じ1件が書き換わる。 */
  rememberUpload(midiFile.name, parsed, midiFile.tempo, {track:i, trackName:t.name, src:midiFile.src||null});
  renderTracks();
  const out=parsed.events.filter(e=> !e.fing).length;
  toast(tt('msg.track_loaded', t.name, parsed.events.length) + (out ? tt('msg.out_range_suffix', out) : ''));
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
  toast(tt('msg.skip_to_first', m, ST.events[0].pitches[0].name));
}

export async function loadScoreFile(file){
  const name=file.name.toLowerCase();
  /* この読み込み操作で作る／書き換えるアップロード1件を決める（MIDIのトラック選び直しも同じ1件） */
  beginUpload(file.name);

  try{
    /* ---- MIDI ---- */
    if(name.endsWith('.mid') || name.endsWith('.midi')){
      const buf=await file.arrayBuffer();
      const m=parseMidi(buf);
      const sel=bestTrackIndex(m.tracks);
      /* 元のMIDIも保存番号に預ける（一覧から開き直したあとトラックを選び直せるようにするため）。
         大きすぎるものは預けない＝そのときはトラック選択のリンクが出ないだけ。 */
      midiFile={tracks:m.tracks, tempo:m.tempo, tsNum:m.tsNum, tsDen:m.tsDen, division:m.division,
                name:file.name, sel, src:bytesToBase64(new Uint8Array(buf))};
      selectTrack(sel);        /* 保存は selectTrack 側で行う（トラックを選び直したぶんも同じ1件を更新） */
      setScoreSub('tracks');   /* 読み込んだ直後はトラックを選ぶ面を出す */
      openDrawer();
      const box=document.getElementById('tracks');
      if(box.scrollIntoView) box.scrollIntoView({block:'nearest'});
      toast(tt('msg.midi_tracks', m.tracks.length));
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
    const restored=setScore(parsed, file.name, file.name);
    rememberUpload(file.name, parsed, parsed.tempo, null);
    closeDrawer();
    toast(tt('msg.score_loaded', parsed.events.length) + (restored ? tt('msg.fing_restored_suffix') : ''));
  }catch(err){
    toast(tt('msg.load_failed', err.message));
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

/* SAMPLE_XML（白鳥）の伴奏コード＝1小節1個。public/songs/swan.json の chords と同じ */
export const SAMPLE_CHORDS = ['G','Am','C','G','G','F#','Bm','D','G','D','F','C','Am','D'];

export function loadSample(quiet){
  try{
    midiFile=null; renderTracks();
    const parsed=parseMusicXML(SAMPLE_XML);
    setTempo(Math.round(parsed.tempo));
    setScore(parsed, 'le-cygne', tt('msg.swan_title'));
    ST.songChords=buildChords(SAMPLE_CHORDS);   /* setScore が消すので、その後に入れる */
    syncDock();
    if(!quiet){ closeDrawer(); toast(tt('msg.swan_loaded')); }
  }catch(e){ toast(tt('msg.preset_err', e.message)); }
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
      toast(tt('msg.scale_built', label, parsed.events.length, parsed.measures.length));
      setTimeout(()=>{ if(ST.mode==='scale' && ST.events.length) startPlay(0); }, 260);  /* 生成したら自動再生 */
    }
  }catch(e){ toast(tt('msg.gen_failed', e.message)); }
}

/* ===== プリセット曲（public/songs/ から外部読み込み） ===== */
/* manifest.json＝曲一覧（起動時に先読み）。個別JSONは曲を選んだ時に fetch する。
   JSONは生データのみ（notes＝[midi, 拍数] の並び）。運指付与・小節割りはここで行う。 */
export const SONGS_DIR = new URL('../public/songs/', import.meta.url);
export let SONGS = {};            /* id -> {id, title, desc, file, tempo} */
export function setSongs(list){
  SONGS={};
  list.forEach(s=>{ if(s && s.id) SONGS[s.id]=s; });
}
/* 曲ボタンを manifest から作り直す */
export function renderSongList(){
  const box=document.getElementById('songBtns');
  if(!box) return;
  const ids=Object.keys(SONGS);
  if(!ids.length){
    box.innerHTML=tt('msg.no_songs_html');
    return;
  }
  box.innerHTML=ids.map(id=>{
    const s=SONGS[id];
    return `<button class="songbtn" data-song="${id}">🎵 ${pickText(s.title)||id}<small>${pickText(s.desc)}</small></button>`;
  }).join('');
}
export async function loadSongManifest(){
  try{
    /* 曲一覧も同一サーバのファイルからしか読まない（src/util.js の localFile） */
    const res=await fetch(localFile('manifest.json', localUrl(SONGS_DIR)), {cache:'no-cache'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const j=await res.json();
    if(!j || !Array.isArray(j.songs)) throw new Error('songs がありません');
    setSongs(j.songs);
  }catch(e){
    setSongs([]);
    console.error('[string] manifest.json を読み込めません：', e);
  }
  renderSongList();
}
/* 曲JSONの伴奏コード（1小節1個）。"C" / "Am" / "F#" / "Bb" / "G7" / {root:0,q:'maj'} を受ける。
   scheduleBar が扱えるのは長三和音・短三和音だけなので、7th 等の付加は無視して maj/min に落とす。 */
export function parseChord(v){
  if(!v) return null;
  if(typeof v==='object'){
    if(typeof v.root!=='number') return null;
    return {root:((v.root%12)+12)%12, q:(v.q==='min')?'min':'maj'};
  }
  const m=String(v).trim().match(/^([A-Ga-g])([#♯b♭]?)(.*)$/);
  if(!m) return null;
  const base={c:0,d:2,e:4,f:5,g:7,a:9,b:11}[m[1].toLowerCase()];
  const acc=(m[2]==='#'||m[2]==='♯') ? 1 : (m[2]==='b'||m[2]==='♭') ? -1 : 0;
  const min=/^(m|min|-)(?!aj)/i.test(m[3]);          /* maj7 を短三和音にしない */
  return {root:(((base+acc)%12)+12)%12, q:min?'min':'maj'};
}
/* 小節数ぶんの配列にする。読めない要素は直前のコードを引き継ぐ（＝空欄で前を保持できる） */
export function buildChords(list){
  if(!Array.isArray(list) || !list.length) return null;
  const out=[]; let last=null;
  for(const v of list){ const c=parseChord(v) || last; out.push(c); last=c; }
  const first=out.find(c=>c);
  if(!first) return null;
  return out.map(c=> c || first);
}

/* 曲JSON（notes＝[midi, 拍数]）→ イベント列。midi が 0/null の要素は休符 */
export function buildSongFromData(data){
  const seq = (data && Array.isArray(data.notes)) ? data.notes : [];
  if(!seq.length) throw new Error('notes がありません');
  const beatsPerMeasure=data.beatsPerMeasure || 4;
  let onset=0;
  const evs=[];
  seq.forEach(it=>{
    const midi=it[0], dur=it[1];
    if(midi){                                          /* 休符はイベントを作らず時間だけ進める */
      const p={midi, name:midiName(midi)};
      evs.push({id:evs.length, measure:Math.floor(onset/beatsPerMeasure)+1, onset, dur, pitches:[p], leadIdx:0, fing:null});
    }
    onset+=dur;
  });
  if(!evs.length) throw new Error('notes がありません');
  evs.forEach(e=>{ e.fing=recommend(e.pitches[0].midi); });
  const maxM=Math.ceil(onset/beatsPerMeasure);
  const measures=[];
  for(let mm=1;mm<=maxM;mm++) measures.push({num:mm, start:(mm-1)*beatsPerMeasure, end:mm*beatsPerMeasure});
  /* beatUnit＝1拍の長さ（4分音符=1）。3/8 など1拍が8分音符の曲は 0.5 を持たせる */
  return {events:evs, measures, beatsPerMeasure, beatUnit:(data.beatUnit>0 ? data.beatUnit : 1)};
}
export async function loadSong(id, quiet){
  const s=SONGS[id];
  if(!s){ toast(tt('msg.soon')); return; }
  try{
    midiFile=null; renderTracks();
    /* manifest.json の "file" は public/songs/ 直下のファイル名だけを受け付ける。
       外部URLや ../ が書かれていた場合は localFile() が例外を投げる（＝読みに行かない）。 */
    const res=await fetch(localFile(s.file || (id+'.json'), localUrl(SONGS_DIR)), {cache:'no-cache'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const parsed=buildSongFromData(data);
    setTempo(Math.round(data.tempo || s.tempo || ST.tempo));
    /* 上部バーに出すのは曲名（言語ごとの表示名）。'song:xxx' は運指の保存キー用の内部IDで、
       画面には出さない。 */
    const title=pickText(data.title) || pickText(s.title) || id;
    setScore(parsed, 'song:'+id, title);
    ST.songChords=buildChords(data.chords);   /* setScore が消すので、その後に入れる */
    syncDock();
    if(!quiet){ closeDrawer(); toast(tt('msg.song_loaded', title)); }
  }catch(e){ toast(tt('msg.song_err', e.message)); }
}
