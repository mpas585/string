/*
  export.js — いま預かっている譜面（音の並び）を MIDI / MusicXML に書き出す。

  入り口は2つだけ。
    buildMidi(score, name)      … Uint8Array（SMF format 1）を返す
    buildMusicXML(score, name)  … 文字列（score-partwise 4.0）を返す
    downloadBlob(bytes, mime, filename) … 実際にダウンロードさせる

  score は uploads.js の packScore() が作る形（サーバに預けている形）そのまま。
      { v, tempo, beatsPerMeasure, beatUnit,
        events:   [開始拍, 長さ, 小節, [midi…], リード番号] の並び,
        measures: [小節番号, 開始拍, 終了拍] の並び }
  ※ 拍の単位は「4分音符＝1」。beatsPerMeasure も4分音符に直した数
     （3/8 なら 1.5、6/8 なら 3）。beatUnit は1拍の長さ（4分音符＝1、8分＝0.5、
     付点4分＝1.5）。拍子記号はこの2つから戻す。
  ※ 運指は書き出さない（MusicXML の fingering は入れない）。譜面の音の並びだけ。
*/
import { INSTRUMENT_ID, INST_CLEF } from './util.js';

/* ===== 共通のこまごま ===== */

const DIV = 480;                 /* 4分音符あたりの分解能（MIDI・MusicXML 共通） */
const EPS = 1e-6;

/* 音名（♯で綴る）。MusicXML の step / alter に分ける */
const STEP  = ['C','C','D','D','E','F','F','G','G','A','A','B'];
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

/* 楽器ごとの音色（General MIDI のプログラム番号） */
const GM = { violin:40, viola:41, cello:42, contrabass:43 };

/* 楽器ごとの音部記号。config/{楽器}.php の clef から決める */
const CLEF = {
  treble: { sign:'G', line:2 },
  alto:   { sign:'C', line:3 },
  bass:   { sign:'F', line:4 },
};

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

/* 拍子記号を戻す。beatsPerMeasure（4分音符換算）と beatUnit（1拍の長さ）から。
     4/4 → beatsPerMeasure 4 / beatUnit 1   → 4/4
     3/8 → 1.5 / 0.5                        → 3/8
     6/8 → 3   / 1.5（付点4分が1拍）        → 6/8
     2/2 → 4   / 2                          → 2/2 */
export function timeSigOf(score){
  const bpm = (score && score.beatsPerMeasure > 0) ? score.beatsPerMeasure : 4;
  const bu  = (score && score.beatUnit > 0) ? score.beatUnit : 1;
  let den, num;
  if(Math.abs(bu - 1.5) < EPS){ den = 8; num = Math.round(bpm * 2); }   /* 6/8・9/8・12/8 */
  else {
    den = Math.round(4 / bu);
    num = Math.round(bpm / bu);
  }
  if(!(den > 0) || !(num > 0)) { return { num:4, den:4 }; }
  /* 2の冪でない分母は MIDI/MusicXML では表せないので 4分の拍に丸める */
  if(![1,2,4,8,16,32].includes(den)) { return { num:Math.max(1, Math.round(bpm)), den:4 }; }
  return { num, den };
}

/* 譜面のイベントを「重ならない・拍順」に整えて返す。
   長さが次の音の開始を越えているものは切り詰める（和音は1イベントの中に入っている）。 */
function tidyEvents(score){
  const raw = (score && Array.isArray(score.events)) ? score.events : [];
  const evs = raw.map(a => ({
    onset: Number(a[0]) || 0,
    dur:   Math.max(Number(a[1]) || 0, 1/64),
    midis: (a[3] || []).map(m => Math.max(0, Math.min(127, Math.round(Number(m) || 0)))),
  })).filter(e => e.midis.length);
  evs.sort((x, y) => x.onset - y.onset);
  for(let i = 0; i < evs.length - 1; i++){
    const gap = evs[i+1].onset - evs[i].onset;
    if(gap > EPS && evs[i].dur > gap) evs[i].dur = gap;
  }
  return evs;
}

/* 小節の区切り（[開始拍, 終了拍] の並び）。持っていなければ拍子から作る */
function measureList(score, evs){
  const src = (score && Array.isArray(score.measures)) ? score.measures : [];
  const out = src
    .map(m => ({ num: Number(m[0]) || 0, start: Number(m[1]) || 0, end: Number(m[2]) || 0 }))
    .filter(m => m.end - m.start > EPS)
    .sort((a, b) => a.start - b.start);
  if(out.length) return out;

  const len  = (score && score.beatsPerMeasure > 0) ? score.beatsPerMeasure : 4;
  const last = evs.length ? Math.max(...evs.map(e => e.onset + e.dur)) : len;
  const n    = Math.max(1, Math.ceil((last - EPS) / len));
  const list = [];
  for(let i = 0; i < n; i++) list.push({ num:i+1, start:i*len, end:(i+1)*len });
  return list;
}

/* ===================================================================
   MIDI（SMF format 1）
   =================================================================== */

/* 可変長数値（デルタタイム用） */
function vlq(n){
  n = Math.max(0, Math.round(n));
  const out = [n & 0x7f];
  n = Math.floor(n / 128);
  while(n > 0){ out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  return out;
}
function str2bytes(s){
  const out = [];
  const u = new TextEncoder().encode(String(s || ''));
  for(let i = 0; i < u.length; i++) out.push(u[i]);
  return out;
}
function chunk(id, body){
  const out = str2bytes(id);
  const n = body.length;
  out.push((n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255);
  return out.concat(body);
}

export function buildMidi(score, name){
  const evs   = tidyEvents(score);
  const ts    = timeSigOf(score);
  const tempo = (score && score.tempo > 0) ? Math.round(score.tempo) : 80;
  const usPerQuarter = Math.round(60000000 / tempo);
  const prog  = GM[INSTRUMENT_ID] != null ? GM[INSTRUMENT_ID] : 42;

  /* --- トラック1：曲名・テンポ・拍子 --- */
  const nm = str2bytes(String(name || 'score').slice(0, 120));
  let t1 = [];
  t1 = t1.concat(vlq(0), [0xFF, 0x03], vlq(nm.length), nm);
  t1 = t1.concat(vlq(0), [0xFF, 0x51, 0x03,
        (usPerQuarter>>>16)&255, (usPerQuarter>>>8)&255, usPerQuarter&255]);
  /* dd は分母の2の対数（4分音符なら 2）。cc/bb はメトロノームの既定値 */
  const dd = Math.round(Math.log2(ts.den));
  t1 = t1.concat(vlq(0), [0xFF, 0x58, 0x04, ts.num & 255, dd & 255, 24, 8]);
  t1 = t1.concat(vlq(0), [0xFF, 0x2F, 0x00]);

  /* --- トラック2：音符 --- */
  const list = [];    /* {tick, type(0=off,1=on), midi} */
  evs.forEach(e => {
    const on  = Math.round(e.onset * DIV);
    const off = Math.max(on + 1, Math.round((e.onset + e.dur) * DIV));
    e.midis.forEach(m => {
      list.push({ tick:on,  type:1, midi:m });
      list.push({ tick:off, type:0, midi:m });
    });
  });
  /* 同じ時刻では OFF を先に置く（同じ音が続くときに切れなくなるのを防ぐ） */
  list.sort((a, b) => (a.tick - b.tick) || (a.type - b.type) || (a.midi - b.midi));

  let t2 = [];
  t2 = t2.concat(vlq(0), [0xC0, prog & 127]);
  let prev = 0;
  list.forEach(n => {
    t2 = t2.concat(vlq(n.tick - prev));
    prev = n.tick;
    if(n.type === 1) t2 = t2.concat([0x90, n.midi & 127, 80]);
    else             t2 = t2.concat([0x80, n.midi & 127, 0]);
  });
  t2 = t2.concat(vlq(0), [0xFF, 0x2F, 0x00]);

  const head = [0, 1, 0, 2, (DIV>>>8)&255, DIV&255];   /* format 1 / 2トラック / 分解能 */
  const bytes = chunk('MThd', head).concat(chunk('MTrk', t1), chunk('MTrk', t2));
  return new Uint8Array(bytes);
}

/* ===================================================================
   MusicXML（score-partwise 4.0）
   =================================================================== */

/* 音価の表（4分音符＝1）。大きいほうから当てる */
const NOTE_TYPES = [
  [4,     'whole'],
  [2,     'half'],
  [1,     'quarter'],
  [0.5,   'eighth'],
  [0.25,  '16th'],
  [0.125, '32nd'],
  [0.0625,'64th'],
];

/* 長さ（4分音符＝1）を、書ける音価の並びに割る。付点つきを先に試す。
   割り切れないぶんは捨てる（1/64 未満）。 */
function splitDur(q){
  const out = [];
  let rest = q, guard = 0;
  while(rest > 1/64 - EPS && guard++ < 24){
    let hit = null;
    for(const [v, t] of NOTE_TYPES){
      if(v * 1.5 <= rest + EPS){ hit = { q:v*1.5, type:t, dots:1 }; break; }
      if(v       <= rest + EPS){ hit = { q:v,     type:t, dots:0 }; break; }
    }
    if(!hit) break;
    out.push(hit);
    rest -= hit.q;
  }
  if(!out.length) out.push({ q:0.25, type:'16th', dots:0 });
  return out;
}

function noteXml(midi, divs, type, dots, tie, voice){
  const pc  = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  let s = '      <note>\n';
  if(midi == null){
    s += '        <rest/>\n';
  } else {
    s += '        <pitch>\n';
    s += '          <step>' + STEP[pc] + '</step>\n';
    if(ALTER[pc]) s += '          <alter>' + ALTER[pc] + '</alter>\n';
    s += '          <octave>' + oct + '</octave>\n';
    s += '        </pitch>\n';
  }
  s += '        <duration>' + divs + '</duration>\n';
  if(tie === 'start' || tie === 'both') s += '        <tie type="start"/>\n';
  if(tie === 'stop'  || tie === 'both') s += '        <tie type="stop"/>\n';
  s += '        <voice>' + (voice || 1) + '</voice>\n';
  s += '        <type>' + type + '</type>\n';
  for(let i = 0; i < dots; i++) s += '        <dot/>\n';
  if(tie){
    s += '        <notations>\n';
    if(tie === 'start' || tie === 'both') s += '          <tied type="start"/>\n';
    if(tie === 'stop'  || tie === 'both') s += '          <tied type="stop"/>\n';
    s += '        </notations>\n';
  }
  s += '      </note>\n';
  return s;
}

/* 和音1つぶん（＝1イベント）を書く。lead を最初に、残りを <chord/> で足す */
function chordXml(midis, q, tie){
  const parts = splitDur(q);
  let s = '';
  parts.forEach((p, i) => {
    const t = (parts.length === 1) ? tie
            : (i === 0) ? ((tie === 'stop' || tie === 'both') ? 'both' : 'start')
            : (i === parts.length - 1) ? ((tie === 'start' || tie === 'both') ? 'both' : 'stop')
            : 'both';
    const divs = Math.round(p.q * DIV);
    midis.forEach((m, k) => {
      const one = noteXml(m, divs, p.type, p.dots, t, 1);
      s += (k === 0) ? one : one.replace('      <note>\n', '      <note>\n        <chord/>\n');
    });
  });
  return s;
}

function restXml(q){
  let s = '';
  splitDur(q).forEach(p => {
    s += noteXml(null, Math.round(p.q * DIV), p.type, p.dots, '', 1);
  });
  return s;
}

export function buildMusicXML(score, name){
  const evs  = tidyEvents(score);
  const ms   = measureList(score, evs);
  const ts   = timeSigOf(score);
  const clef = CLEF[INST_CLEF] || CLEF.bass;
  const tempo= (score && score.tempo > 0) ? Math.round(score.tempo) : 80;
  const title= String(name || 'score');

  /* イベントを小節の境目で切り、タイでつなぐ */
  const segs = [];    /* {mi, start, dur, midis, tie} */
  evs.forEach(e => {
    let s = e.onset, left = e.dur, first = true;
    let mi = ms.findIndex(m => s < m.end - EPS && s >= m.start - EPS);
    if(mi < 0) mi = ms.length - 1;
    while(left > EPS && mi >= 0 && mi < ms.length){
      const room = Math.min(left, ms[mi].end - s);
      if(room <= EPS) break;
      const last = (left - room) <= EPS;
      segs.push({
        mi, start:s, dur:room, midis:e.midis,
        tie: first ? (last ? '' : 'start') : (last ? 'stop' : 'both'),
      });
      left -= room; s += room; first = false;
      mi++;
      if(mi < ms.length) s = ms[mi].start;
    }
  });

  let body = '';
  ms.forEach((m, mi) => {
    const inM = segs.filter(g => g.mi === mi).sort((a, b) => a.start - b.start);
    body += '    <measure number="' + (m.num || (mi + 1)) + '">\n';
    if(mi === 0){
      body += '      <attributes>\n';
      body += '        <divisions>' + DIV + '</divisions>\n';
      body += '        <key><fifths>0</fifths></key>\n';
      body += '        <time><beats>' + ts.num + '</beats><beat-type>' + ts.den + '</beat-type></time>\n';
      body += '        <clef><sign>' + clef.sign + '</sign><line>' + clef.line + '</line></clef>\n';
      body += '      </attributes>\n';
      body += '      <direction placement="above">\n';
      body += '        <direction-type><metronome><beat-unit>quarter</beat-unit>'
            + '<per-minute>' + tempo + '</per-minute></metronome></direction-type>\n';
      body += '        <sound tempo="' + tempo + '"/>\n';
      body += '      </direction>\n';
    }
    let cur = m.start;
    inM.forEach(g => {
      if(g.start - cur > 1/64){ body += restXml(g.start - cur); cur = g.start; }
      body += chordXml(g.midis, g.dur, g.tie);
      cur = g.start + g.dur;
    });
    if(m.end - cur > 1/64) body += restXml(m.end - cur);
    body += '    </measure>\n';
  });

  let x = '<?xml version="1.0" encoding="UTF-8"?>\n';
  x += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
     + '"http://www.musicxml.org/dtds/partwise.dtd">\n';
  x += '<score-partwise version="4.0">\n';
  x += '  <work><work-title>' + esc(title) + '</work-title></work>\n';
  x += '  <identification>\n';
  x += '    <encoding><software>GEN strings</software></encoding>\n';
  x += '  </identification>\n';
  x += '  <part-list>\n';
  x += '    <score-part id="P1">\n';
  x += '      <part-name>' + esc(INSTRUMENT_ID) + '</part-name>\n';
  x += '      <midi-instrument id="P1-I1"><midi-program>'
     + ((GM[INSTRUMENT_ID] != null ? GM[INSTRUMENT_ID] : 42) + 1)
     + '</midi-program></midi-instrument>\n';
  x += '    </score-part>\n';
  x += '  </part-list>\n';
  x += '  <part id="P1">\n';
  x += body;
  x += '  </part>\n';
  x += '</score-partwise>\n';
  return x;
}

/* ===================================================================
   ダウンロード
   =================================================================== */

/* ファイル名に使えない字を落とす。空になったら score にする */
export function safeName(s){
  const n = String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return n.slice(0, 80) || 'score';
}

export function downloadBlob(data, mime, filename){
  const blob = new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch(e){} }, 1000);
}
