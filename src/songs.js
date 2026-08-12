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
        notation(scrollStaffToActive),
        scheduler(measureOfBeat/setSeekHead/setTempo/startPlay),
        modes(render/scrollStripToActive/setScore), drawer(closeDrawer/openDrawer/setScoreSub),
        dom(toast), uploads(beginUpload/rememberUpload)。JSZip は基幹PHPでグローバル読み込み。
  ※ PDFの参照表示・読み取り（OMR）は廃止した（.pdf は受け付けない）。
*/
import { ST } from './state.js';
import { midiName, OPEN, tt, pickText, localFile, localUrl } from './util.js';
import { recommend, scrollBoardToActive, FB } from './fingerboard.js';
import { scrollStaffToActive } from './notation.js';
import { measureOfBeat, setSeekHead, setTempo, startPlay, stopPlay } from './audio/scheduler.js';
import { render, scrollStripToActive, setScore, syncDock } from './modes.js';
import { closeDrawer, openDrawer, setScoreSub } from './drawer.js';
import { toast, setFabLed } from './dom.js';
/* お気に入り（曲一覧の右端のハートと、お気に入りだけの絞り込みに使う） */
import { isFav } from './favorites.js';
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

  /* 譜面が持っている曲名。<work-title> → <movement-title> → <credit-words> の順で拾う。
     読み込んだ譜面に付ける名前として使う（無ければ呼び出し側がファイル名を使う）。 */
  let title = '';
  const wtEl = doc.querySelector('work > work-title');
  if(wtEl) title = wtEl.textContent.trim();
  if(!title){ const mtEl = doc.querySelector('movement-title'); if(mtEl) title = mtEl.textContent.trim(); }
  if(!title){ const cwEl = doc.querySelector('credit > credit-words'); if(cwEl) title = cwEl.textContent.trim(); }

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
  const slurMarks = [];
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
          if(pEl){
            raw.push({onset, dur, midi:pitchToMidi(pEl), measure:mi+1});
            /* スラー（<notations><slur type="start|stop" number>）を拾う。番号ごとに開始→終了で対にする。
               まとめ役はイベント（同時刻の音の束）なので、ここでは音の onset とだけ結びつけておく。 */
            node.querySelectorAll(':scope > notations > slur').forEach(sl=>{
              const ty=sl.getAttribute('type');
              if(ty==='start' || ty==='stop'){
                slurMarks.push({key:Math.round(onset*1000)/1000, type:ty, num:sl.getAttribute('number')||'1'});
              }
            });
          }
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

  /* スラー：音の onset → イベント添字。番号ごとに開始をスタックへ積み、終了で対にする
     （2音に限らず、開始と終了のあいだの音は全部そのスラーの中）。 */
  const onsetToIdx = new Map();
  evs.forEach((e,i)=> onsetToIdx.set(Math.round(e.onset*1000)/1000, i));
  const openNum = {};
  const slurs = [];
  for(const mk of slurMarks){
    const idx = onsetToIdx.get(mk.key);
    if(idx==null) continue;
    if(mk.type==='start'){ (openNum[mk.num] || (openNum[mk.num]=[])).push(idx); }
    else { const st=(openNum[mk.num]||[]).pop(); if(st!=null && idx>st) slurs.push([st,idx]); }
  }
  /* 同じ範囲が重複することがある（和音や多声部で、同じスラーが複数の音符に付く）ので、まとめる。 */
  const seen=new Set(); const uniqSlurs=[];
  for(const g of slurs){ const k=g[0]+':'+g[1]; if(!seen.has(k)){ seen.add(k); uniqSlurs.push(g); } }
  uniqSlurs.sort((a,b)=> a[0]-b[0] || a[1]-b[1]);

  return {events:evs, tempo, measures:mList, beatsPerMeasure, beatUnit, title, slurs:uniqSlurs};
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
  /* 曲名。SMF では先頭トラックのシーケンス名（メタ0x03）がそれにあたる
     （フォーマット1では最初の「指揮トラック」、フォーマット0では唯一のトラック）。
     読み込んだ譜面に付ける名前として使う（無ければ呼び出し側がファイル名を使う）。 */
  let title='';
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
    if(t===0 && name) title=name;
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
  return {tracks, tempo, tsNum, tsDen, division, title};
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

/* 伴奏に選べる音色。ピアノ＝コード、オルガン／ストリングス／ギター＝旋律的な持続・撥弦、
   ベース＝低音、スネア／ハット／バスドラム＝打楽器（音程は無視して1発ずつ）。既定はピアノ。 */
export const INSTRUMENTS = ['piano','organ','strings','guitar','bass','snare','hat','bassdrum'];

/* トラック（絶対オンセット形式 [onset,dur,...midis]）→ イベント列。休符は要素を作らない。 */
export function seqToEvents(seq, bpm, bu){
  bpm=bpm||4; bu=(bu>0)?bu:1;
  const evs=[];
  (seq||[]).forEach(it=>{
    const onset=it[0], dur=it[1], midis=it.slice(2).filter(m=>!!m);
    if(midis.length){
      const pitches=midis.slice().sort((a,b)=>a-b).map(m=>({midi:m, name:midiName(m)}));
      evs.push({id:0, measure:Math.floor(onset/bpm)+1, onset, dur, pitches, leadIdx:pitches.length-1, fing:null});
    }
  });
  evs.sort((a,b)=> a.onset-b.onset);
  evs.forEach((e,i)=>{ e.id=i; e.fing=recommend(e.pitches[e.leadIdx].midi); });
  let maxEnd=0; for(const e of evs){ const en=e.onset+e.dur; if(en>maxEnd) maxEnd=en; }
  const maxM=Math.max(1, Math.ceil(maxEnd/bpm));
  const measures=[]; for(let m=1;m<=maxM;m++) measures.push({num:m, start:(m-1)*bpm, end:m*bpm});
  return {events:evs, measures, beatsPerMeasure:bpm, beatUnit:bu};
}
/* トラックのイベント列を得る（MIDIはその場で、XML/曲は seq から。結果はトラックに載せて使い回す） */
export function trackEvents(t){
  if(t._ev) return t._ev;
  let parsed;
  if(midiFile && midiFile.kind==='midi'){
    parsed=midiTrackToEvents(t, midiFile.division, midiFile.tsNum, midiFile.tsDen);
  } else {
    parsed=seqToEvents(t.seq||[], midiFile?midiFile.beatsPerMeasure:4, midiFile?midiFile.beatUnit:1);
  }
  t._ev=parsed;
  return parsed;
}
/* メロディガイドの初期トラック（seq または notes を持つトラック用の汎用版） */
export function pickGuideIndex(tracks){
  let best=0, bestScore=-1;
  tracks.forEach((t,i)=>{
    if(t.drum) return;
    let inRange=0;
    if(t.seq){ for(const e of t.seq){ for(let j=2;j<e.length;j++){ const m=e[j]; if(m>=OPEN[0] && m<=OPEN[3]+FB.maxOff) inRange++; } } }
    else if(t.notes){ for(const n of t.notes){ if(n.midi>=OPEN[0] && n.midi<=OPEN[3]+FB.maxOff) inRange++; } }
    if(!inRange) return;
    let score=inRange;
    if(MELODY_RE.test(t.name)) score += 1e6;
    if(score>bestScore){ bestScore=score; best=i; }
  });
  return bestScore>0 ? best : 0;
}
/* 伴奏に割り当てたトラックを ST.accompTracks に組み立てる（伴奏モードON時に鳴る） */
export function buildAccomp(){
  ST.accompTracks=[];
  if(midiFile && Array.isArray(midiFile.tracks)){
    midiFile.tracks.forEach(t=>{
      if(t.role!=='accomp') return;
      const parsed=trackEvents(t);
      const ev=parsed.events.map(e=>({onset:e.onset, dur:e.dur, midis:e.pitches.map(pp=>pp.midi)}));
      if(ev.length) ST.accompTracks.push({inst:t.inst||'piano', ev});
    });
  }
  syncDock();   /* 伴奏ボタンの表示を更新（伴奏トラックがあれば出す） */
}

export let midiFile=null;
export function setMidiFile(v){ midiFile=v; }  /* 分割対応: 外部モジュールからの代入用 */
export function renderTracks(){
  const box=document.getElementById('tracks');
  const list=document.getElementById('trackList');
  if(!midiFile){ box.classList.remove('show'); list.innerHTML=''; return; }
  box.classList.add('show');
  const instOpts=(sel)=> INSTRUMENTS.map(v=>`<option value="${v}"${v===sel?' selected':''}>${tt('ui.inst_'+v)}</option>`).join('');
  list.innerHTML = midiFile.tracks.map((t,i)=>{
    const range = `${midiName(t.lo)}–${midiName(t.hi)}`;
    const role = t.role || 'mute';
    const rbtn=(r,lbl)=> `<button type="button" class="rbtn${role===r?' on':''}" data-i="${i}" data-role="${r}">${lbl}</button>`;
    const instRow = (role==='accomp')
      ? `<span class="tinstwrap"><label>${tt('ui.inst_label')}</label>`
        + `<select class="tinst" data-i="${i}">${instOpts(t.inst||'piano')}</select></span>`
      : '';
    return `<div class="trow${role==='guide'?' on':''}" data-i="${i}">`
      + `<span class="tn">${t.name}<small>${range}</small></span>`
      + `<span class="tc">${tt('msg.track_count', t.count)}</span>`
      + `<span class="troles">`
      +   rbtn('guide', tt('ui.role_guide'))
      +   rbtn('accomp', tt('ui.role_accomp'))
      +   rbtn('mute', tt('ui.role_mute'))
      + `</span>`
      + instRow
      + `</div>`;
  }).join('');
}
/* トラックの役割を変える（メロディガイド＝1つだけ・伴奏・ミュート）。試聴はしない。 */
export function setTrackRole(i, role){
  if(!midiFile || !midiFile.tracks[i]) return;
  if(role==='guide'){
    selectTrack(i);          /* ガイド＝練習する譜面。ここで他のガイドは自動でミュートに落ちる */
    return;
  }
  midiFile.tracks[i].role = (role==='accomp') ? 'accomp' : 'mute';
  renderTracks();
  buildAccomp();
}
/* 伴奏トラックの音色を変える */
export function setTrackInst(i, inst){
  if(!midiFile || !midiFile.tracks[i]) return;
  if(INSTRUMENTS.indexOf(inst)<0) inst='piano';
  midiFile.tracks[i].inst=inst;
  buildAccomp();
}
export function selectTrack(i, play){
  if(!midiFile || !midiFile.tracks[i]) return;
  /* 再生中に別のトラックを選んだ＝いま鳴っているものは止めてから差し替える */
  if(ST.playing) stopPlay();
  midiFile.sel=i;
  /* 役割を更新：選んだトラックをメロディガイドにし、他のガイドはミュートへ落とす（ガイドは1つだけ） */
  midiFile.tracks.forEach((t,k)=>{ if(k!==i && t.role==='guide') t.role='mute'; });
  const t=midiFile.tracks[i];
  t.role='guide';
  const parsed=trackEvents(t);
  const base = midiFile.keyBase || midiFile.name || '';
  const scoreName = base + '#' + i;
  const title = (midiFile.kind==='song')
    ? (midiFile.title || base)
    : ((midiFile.name || base) + ' / ' + t.name);
  setTempo(Math.round(midiFile.tempo || ST.tempo));
  setScore(parsed, scoreName, title);
  /* 保存：アップロードしたMIDIのときだけ（曲・XMLは保存対象にしない） */
  if(midiFile.kind==='midi'){
    rememberUpload(midiFile.name, parsed, midiFile.tempo, {track:i, trackName:t.name, src:midiFile.src||null});
  }
  buildAccomp();            /* setScore が accompTracks を消すので、ここで組み直す */
  renderTracks();
  const out=parsed.events.filter(e=> !e.fing).length;
  toast(tt('msg.track_loaded', t.name, parsed.events.length) + (out ? tt('msg.out_range_suffix', out) : ''));
  if(play && ST.events.length){
    const first=firstNoteBeat();
    ST.playhead=first;
    if(play==='select'){
      closeDrawer();
      setTimeout(()=> startPlay(first), 200);
    }else{
      setTimeout(()=> startPlay(first, true), 200);
    }
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

/* 読み込んだ譜面に付ける名前。データが曲名を持っていればそれを使い、
   持っていなければファイル名を使う（この名前がそのまま一覧・上部バー・公開時の曲名になる）。 */
function scoreNameOf(dataTitle, file){
  const t=String(dataTitle||'').trim();
  return t || file.name;
}
/* 複数パートの MusicXML を、パート＝トラックとして取り出す（伴奏用に多声も保持）。
   1パートだけのときは従来どおり parseMusicXML を使う（スラーなども拾える）ので、こちらは呼ばない。 */
export function parseMusicXMLTracks(text){
  const doc=new DOMParser().parseFromString(text, 'application/xml');
  if(doc.querySelector('parsererror')) throw new Error(tt('msg.xml_parse_fail'));
  if(!doc.querySelector('score-partwise')) throw new Error(tt('msg.not_musicxml'));
  let title='';
  const wtEl=doc.querySelector('work > work-title'); if(wtEl) title=wtEl.textContent.trim();
  if(!title){ const mtEl=doc.querySelector('movement-title'); if(mtEl) title=mtEl.textContent.trim(); }
  if(!title){ const cwEl=doc.querySelector('credit > credit-words'); if(cwEl) title=cwEl.textContent.trim(); }
  let tempo=ST.tempo;
  const sT=doc.querySelector('sound[tempo]');
  if(sT) tempo=parseFloat(sT.getAttribute('tempo'));
  else { const pm=doc.querySelector('metronome per-minute'); if(pm) tempo=parseFloat(pm.textContent); }
  let bpm=4, bu=1;
  const timeEl=doc.querySelector('time');
  if(timeEl){ const b=timeEl.querySelector('beats'), bt=timeEl.querySelector('beat-type');
    if(b&&bt){ const bn=parseInt(b.textContent,10), btn=parseInt(bt.textContent,10);
      if(bn>0&&btn>0){ bpm=bn*(4/btn); bu=beatUnitOf(bn,btn); } } }
  const names={};
  doc.querySelectorAll('part-list > score-part').forEach(sp=>{
    const id=sp.getAttribute('id'); const pn=sp.querySelector('part-name');
    names[id]=(pn && pn.textContent.trim()) ? pn.textContent.trim() : id;
  });
  const parts=doc.querySelectorAll('score-partwise > part');
  const tracks=[];
  parts.forEach(part=>{
    const pid=part.getAttribute('id');
    let divisions=1, cursor=0, lastOnset=0;
    const raw=[];   /* {onset,dur,midi,ts,tp} */
    part.querySelectorAll(':scope > measure').forEach(m=>{
      const mStart=cursor; let mMax=cursor;
      for(const node of m.children){
        const tag=node.tagName;
        if(tag==='attributes'){ const d=node.querySelector('divisions'); if(d) divisions=parseInt(d.textContent,10)||divisions; }
        else if(tag==='note'){
          const durEl=node.querySelector('duration');
          const dur=durEl ? (parseInt(durEl.textContent,10)/divisions) : 0;
          const isChord=!!node.querySelector('chord');
          const isRest =!!node.querySelector('rest');
          const onset=isChord ? lastOnset : cursor;
          if(!isRest){
            const pEl=node.querySelector('pitch');
            if(pEl){
              let ts=false, tp=false;
              node.querySelectorAll(':scope > tie').forEach(x=>{ const y=x.getAttribute('type'); if(y==='start')ts=true; else if(y==='stop')tp=true; });
              node.querySelectorAll(':scope > notations > tied').forEach(x=>{ const y=x.getAttribute('type'); if(y==='start')ts=true; else if(y==='stop')tp=true; });
              raw.push({onset, dur, midi:pitchToMidi(pEl), ts, tp});
            }
          }
          if(!isChord){ cursor+=dur; lastOnset=onset; }
          if(cursor>mMax) mMax=cursor;
        }
        else if(tag==='backup'){ const d=node.querySelector('duration'); if(d) cursor-=parseInt(d.textContent,10)/divisions; }
        else if(tag==='forward'){ const d=node.querySelector('duration'); if(d){ cursor+=parseInt(d.textContent,10)/divisions; if(cursor>mMax) mMax=cursor; } }
      }
      cursor=Math.max(mMax, mStart+bpm);
    });
    /* タイでつながる同音は1音にまとめる（音程ごとに連結） */
    raw.sort((a,b)=> a.midi-b.midi || a.onset-b.onset);
    const merged=[];
    for(let i=0;i<raw.length;){
      let onset=raw[i].onset, dur=raw[i].dur, midi=raw[i].midi, ts=raw[i].ts, k=i+1;
      while(ts && k<raw.length){
        const n=raw[k];
        if(n.midi===midi && Math.abs(n.onset-(onset+dur))<1e-3 && n.tp){ dur+=n.dur; ts=n.ts; k++; }
        else break;
      }
      merged.push({onset:Math.round(onset*1e4)/1e4, dur:Math.round(dur*1e4)/1e4, midi});
      i=k;
    }
    /* 同時刻を和音にまとめて [onset,dur,...midis] に */
    const map=new Map();
    merged.forEach(r=>{ const key=Math.round(r.onset*1e4)/1e4;
      if(!map.has(key)) map.set(key,{onset:r.onset, dur:r.dur, midis:new Set()});
      const g=map.get(key); g.midis.add(r.midi); g.dur=Math.max(g.dur, r.dur); });
    const seq=[...map.values()].sort((a,b)=> a.onset-b.onset)
      .map(g=> [Math.round(g.onset*1e4)/1e4, Math.round(g.dur*1e4)/1e4, ...[...g.midis].sort((x,y)=>x-y)]);
    let lo=127, hi=0, cnt=0;
    seq.forEach(e=>{ for(let j=2;j<e.length;j++){ cnt++; const mm=e[j]; if(mm<lo)lo=mm; if(mm>hi)hi=mm; } });
    if(!cnt){ lo=0; hi=0; }
    tracks.push({index:tracks.length, name:names[pid]||('Part '+(tracks.length+1)),
                 seq, count:seq.length, lo, hi, drum:false, role:'mute', inst:'piano'});
  });
  if(!tracks.length) throw new Error(tt('msg.no_notes'));
  return {tracks, tempo, beatsPerMeasure:bpm, beatUnit:bu, title};
}
export async function loadScoreFile(file){
  const name=file.name.toLowerCase();

  try{
    /* ---- MIDI ---- */
    if(name.endsWith('.mid') || name.endsWith('.midi')){
      const buf=await file.arrayBuffer();
      const m=parseMidi(buf);
      const title=scoreNameOf(m.title, file);
      /* この読み込み操作で作る／書き換えるアップロード1件を決める（MIDIのトラック選び直しも同じ1件） */
      beginUpload(title);
      const sel=bestTrackIndex(m.tracks);
      /* 元のMIDIも保存番号に預ける（一覧から開き直したあとトラックを選び直せるようにするため）。
         大きすぎるものは預けない＝そのときはトラック選択のリンクが出ないだけ。 */
      /* 各トラックに役割（既定＝ミュート）と音色（既定＝ピアノ）を持たせる。selectTrack がガイドを立てる */
      m.tracks.forEach(t=>{ t.role='mute'; t.inst='piano'; });
      midiFile={kind:'midi', tracks:m.tracks, tempo:m.tempo, tsNum:m.tsNum, tsDen:m.tsDen, division:m.division,
                name:title, keyBase:title, title, sel, src:bytesToBase64(new Uint8Array(buf))};
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
    /* 複数パートの MusicXML は MIDI と同じくトラック選択（メロディガイド／伴奏／ミュート）を出す */
    let mt=null;
    try{ mt=parseMusicXMLTracks(text); }catch(e){ mt=null; }
    if(mt && mt.tracks.length>1){
      const title=scoreNameOf(mt.title, file);
      beginUpload(title);
      mt.tracks.forEach(t=>{ t.role='mute'; if(!t.inst) t.inst='piano'; });
      const sel=pickGuideIndex(mt.tracks);
      midiFile={kind:'xml', tracks:mt.tracks, tempo:mt.tempo,
                beatsPerMeasure:mt.beatsPerMeasure, beatUnit:mt.beatUnit,
                name:title, keyBase:title, title, sel, src:null};
      setTempo(Math.round(mt.tempo));
      selectTrack(sel);                       /* ガイドを立てて譜面をセット（buildAccomp も走る） */
      rememberUpload(title, ST.parsed, mt.tempo, null);   /* ガイドの譜面だけは保存に残す */
      setScoreSub('tracks'); openDrawer();
      const box=document.getElementById('tracks');
      if(box && box.scrollIntoView) box.scrollIntoView({block:'nearest'});
      toast(tt('msg.midi_tracks', mt.tracks.length));
      return;
    }
    const parsed=parseMusicXML(text);
    const title=scoreNameOf(parsed.title, file);
    beginUpload(title);
    setTempo(Math.round(parsed.tempo));
    const restored=setScore(parsed, title, title);
    rememberUpload(title, parsed, parsed.tempo, null);
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

/* ===== スケール練習は廃止した =====
   ここにあったスケール生成（genScale）は使われていない写しだった。
   同じ内容は「曲を練習する」の課題曲『Cメジャースケール』
   （public/songs/c_major_scale.json）で弾ける。 */

/* ===== プリセット曲（public/songs/ から外部読み込み） ===== */
/* manifest.json＝曲一覧（起動時に先読み）。個別JSONは曲を選んだ時に fetch する。
   JSONは生データのみ（notes＝[midi, 拍数] の並び）。運指付与・小節割りはここで行う。 */
export const SONGS_DIR = new URL('../public/songs/', import.meta.url);
export let SONGS = {};            /* id -> {id, title, desc, file, tempo} */
export function setSongs(list){
  SONGS={};
  list.forEach(s=>{ if(s && s.id) SONGS[s.id]=s; });
}
/* 難易度（manifest.json の level）1〜3 を★で出す。level が無い曲は何も出さない */
export function levelStars(level){
  const n=Math.round(Number(level));
  if(!(n>=1)) return '';
  const lv=Math.min(3, n);
  return `<span class="lv" title="${tt('ui.level')}">${'★'.repeat(lv)}${'☆'.repeat(3-lv)}</span>`;
}
/* ===== 共有された曲（利用者が公開した楽譜） =====
   中身を取りに行くのは src/shares.js。ここは受け取って一覧に混ぜるだけ。
   1件は {id, name, sub, notes, mine}。あらかじめ用意した曲と違って
   難易度（level）も伴奏コードも持たない＝★も伴奏も出ない。 */
export let SHARED=[];
export function setShared(list){ SHARED = Array.isArray(list) ? list : []; }

/* 絞り込みの語と、いま見せているページ（1始まり）。どちらも画面の操作で変わる */
export const SONGS_PER_PAGE=50;          /* サーバ側 SHARE_PAGE と合わせる */
let songQuery='';
let songPage=1;
export function setSongQuery(q){ songQuery=String(q||''); songPage=1; renderSongList(); }
export function setSongPage(p){
  const n=parseInt(p,10);
  songPage=(isFinite(n) && n>0) ? n : 1;
  renderSongList();
}
export function songListPage(){ return songPage; }
/* お気に入りだけに絞るかどうか。開くたびに解除する（＝端末には残さない）。
   押されたときの見た目の切り替えは src/favorites.js の syncFavFilterBtn。 */
let favOnly=false;
export function favFilterOn(){ return favOnly; }
export function setFavFilter(v){ favOnly=!!v; songPage=1; renderSongList(); }

/* 画面に出す文字はすべてここを通す。共有された曲の名前は利用者が付けたものなので、
   そのまま流し込むと HTML として解釈されてしまう（src/uploads.js の esc と同じ作り）。 */
function esc(s){
  return String(s==null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* あらかじめ用意した曲 ＋ 共有された曲を、1本の並びにする。
   key はボタンに載せる内部ID。共有された曲は 'sh:' を頭に付けて見分ける。 */
function songEntries(){
  const out=[];
  Object.keys(SONGS).forEach(id=>{
    const s=SONGS[id];
    out.push({key:id, share:false, title:pickText(s.title)||id, desc:pickText(s.desc)||'', level:s.level});
  });
  SHARED.forEach(it=>{
    out.push({key:'sh:'+it.id, share:true, id:it.id, title:it.name||'', desc:it.sub||'', mine:!!it.mine});
  });
  return out;
}

/* 曲ボタンを作り直す（絞り込み・50件ごとのページ送りつき） */
export function renderSongList(){
  const box=document.getElementById('songBtns');
  if(!box) return;

  const all=songEntries();
  const q=songQuery.trim().toLowerCase();
  let list=q ? all.filter(e=> (e.title+' '+e.desc).toLowerCase().indexOf(q)>=0) : all;
  /* ❤お気に入りが押されているあいだは、印を付けた曲だけにする */
  if(favOnly) list=list.filter(e=> isFav(e.key));

  const pages=Math.max(1, Math.ceil(list.length/SONGS_PER_PAGE));
  if(songPage>pages) songPage=pages;
  if(songPage<1)     songPage=1;
  const view=list.slice((songPage-1)*SONGS_PER_PAGE, songPage*SONGS_PER_PAGE);

  if(!view.length){
    /* お気に入りで消えたのか、絞り込みで消えたのか、そもそも曲が無いのかを言い分ける */
    box.innerHTML = favOnly ? `<div class="upempty">${esc(tt('ui.fav_none'))}</div>`
                  : q       ? `<div class="upempty">${esc(tt('share.no_hit'))}</div>`
                            : tt('msg.no_songs_html');
  }else{
    box.innerHTML=view.map(e=>{
      /* お気に入りの印。付いている曲はボタンの右端にハートを出す（付け外しは指板の左上） */
      const fav = isFav(e.key) ? `<span class="fav" aria-hidden="true">\u2764</span>` : '';
      const fc  = isFav(e.key) ? ' hasfav' : '';
      if(!e.share){
        /* あらかじめ用意した曲（これまでどおり。難易度の★もこちらだけ） */
        return `<button class="songbtn${fc}" data-song="${e.key}">${e.title}`
          + `<small>${levelStars(e.level)}${e.desc}</small>${fav}</button>`;
      }
      /* 共有された曲。難易度は持たないので★は出さない。
         ボタンの入れ子にできないので、曲のボタンと［公開をやめる］は横に並べる。
         削除依頼はお問い合わせフォーム（歯車 →お問い合わせ →種別で「削除依頼」）へ移した。 */
      const mine = e.mine
        ? `<button type="button" class="shbtn shun" data-unshare="${e.id}">${esc(tt('share.unshare'))}</button>`
        : '';
      return `<div class="shrow">`
        + `<button class="songbtn${fc}" data-song="${e.key}">${esc(e.title)}`
        +   `<small><span class="shbadge" title="${esc(tt('share.badge_title'))}">${esc(tt('share.badge'))}</span>${esc(e.desc)}</small>${fav}</button>`
        + (mine ? `<span class="shb">` + mine + `</span>` : '')
        + `</div>`;
    }).join('');
  }
  renderSongPager(pages);
}

/* ページ送り。1ページに収まっているあいだは出さない */
function renderSongPager(pages){
  const el=document.getElementById('songPager');
  if(!el) return;
  if(pages<=1){ el.hidden=true; el.innerHTML=''; return; }
  el.hidden=false;
  el.innerHTML=`<button type="button" class="pgb" data-pg="prev"${songPage<=1?' disabled':''}>${esc(tt('share.prev'))}</button>`
    + `<span class="pgi">${esc(tt('share.page', songPage, pages))}</span>`
    + `<button type="button" class="pgb" data-pg="next"${songPage>=pages?' disabled':''}>${esc(tt('share.next'))}</button>`;
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
  return {events:evs, measures, beatsPerMeasure, beatUnit:(data.beatUnit>0 ? data.beatUnit : 1),
          slurs:(Array.isArray(data.slurs) ? data.slurs.map(g=>[g[0],g[1]]) : [])};
}
/* 曲データの octave 指定を今の楽器に合わせて解決する。
   数値なら全楽器共通、{cello:-2, ...} のような指定なら該当楽器（無ければ default）を返す。 */
function songOctaveHint(data){
  const o=data && data.octave;
  if(o==null) return null;
  if(typeof o==='number') return o|0;
  if(typeof o==='object'){
    const id=(typeof window!=='undefined' && window.INSTRUMENT && window.INSTRUMENT.id) || 'cello';
    const v=(id in o) ? o[id] : (('default' in o) ? o.default : null);
    return (typeof v==='number') ? (v|0) : null;
  }
  return null;
}
export async function loadSong(id, quiet){
  const s=SONGS[id];
  if(!s){ toast(tt('msg.soon')); return; }
  /* 再生中に別の曲を選んだ＝いま鳴っている曲は止めてから読み込む */
  if(ST.playing) stopPlay();
  try{
    midiFile=null; renderTracks();
    /* manifest.json の "file" は public/songs/ 直下のファイル名だけを受け付ける。
       外部URLや ../ が書かれていた場合は localFile() が例外を投げる（＝読みに行かない）。 */
    const res=await fetch(localFile(s.file || (id+'.json'), localUrl(SONGS_DIR)), {cache:'no-cache'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const title=pickText(data.title) || pickText(s.title) || id;
    /* パートを持つ曲（ガイド＝練習する旋律、伴奏＝譜面についていたパート）。
       プリセット曲ではトラック選択は出さない（役割は曲データ側で固定。UIは自分のアップ曲だけ）。
       伴奏は「伴奏モード」ONのとき、各パートの音色で一緒に鳴る。コードは使わない。 */
    if(Array.isArray(data.tracks) && data.tracks.length){
      const bpm=data.beatsPerMeasure||4, bu=(data.beatUnit>0)?data.beatUnit:1;
      let gi=data.tracks.findIndex(t=>t.role==='guide'); if(gi<0) gi=0;
      const guideSeq=Array.isArray(data.tracks[gi].notes)?data.tracks[gi].notes:[];
      const parsed=seqToEvents(guideSeq, bpm, bu);
      /* ガイドのスラー（音符添字の[開始,終了]対）を指板に反映する */
      parsed.slurs=Array.isArray(data.slurs)? data.slurs.map(g=>[g[0],g[1]]) : [];
      { const oh=songOctaveHint(data); parsed.octaveHint=oh;
        if(oh!=null) ST.octave='auto'; }        /* 推奨オクターブのある曲は自動選択で開く＝推奨ポジションに合わせる */
      setTempo(Math.round(data.tempo || s.tempo || ST.tempo));
      setScore(parsed, 'song:'+id, title);
      /* 伴奏トラックを直接組み立てる（midiFile は使わない＝トラック選択UIは出ない） */
      ST.accompTracks=[];
      data.tracks.forEach((t,i)=>{
        if(i===gi || t.role!=='accomp') return;
        const inst=(INSTRUMENTS.indexOf(t.inst)>=0)?t.inst:'piano';
        const pev=seqToEvents(Array.isArray(t.notes)?t.notes:[], bpm, bu).events
                  .map(e=>({onset:e.onset, dur:e.dur, midis:e.pitches.map(pp=>pp.midi)}));
        if(pev.length) ST.accompTracks.push({inst, ev:pev});
      });
      ST.songChords=null;                 /* コードは使わない（パートで鳴らす） */
      midiFile=null; renderTracks();      /* 念のためトラックUIを消しておく */
      syncDock();                         /* 伴奏パートがあれば「伴奏」ボタンを出す */
      if(!quiet){ closeDrawer(); setFabLed(); toast(tt('msg.song_loaded', title)); }
      return;
    }
    /* パートを持たない旧来の曲：単旋律（notes＝[midi,拍数]）。従来どおり。 */
    const parsed=buildSongFromData(data);
    { const oh=songOctaveHint(data); parsed.octaveHint=oh;
      if(oh!=null) ST.octave='auto'; }        /* 推奨オクターブのある曲は自動選択で開く＝推奨ポジションに合わせる */
    setTempo(Math.round(data.tempo || s.tempo || ST.tempo));
    /* 上部バーに出すのは曲名（言語ごとの表示名）。'song:xxx' は運指の保存キー用の内部IDで、
       画面には出さない。 */
    setScore(parsed, 'song:'+id, title);
    ST.songChords=buildChords(data.chords);   /* setScore が消すので、その後に入れる */
    syncDock();
    /* ドロワーが閉じて指板だけになるので、次に押す ▶ を光らせて示す */
    if(!quiet){ closeDrawer(); setFabLed(); toast(tt('msg.song_loaded', title)); }

  }catch(e){ toast(tt('msg.song_err', e.message)); }
}
