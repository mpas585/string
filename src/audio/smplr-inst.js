/*
  audio/smplr-inst.js — smplr(Soundfont) 音源の生成・読み込み・バス結線。

  役割
    ・練習対象のメロディ弦（violin/viola/cello/contrabass）と伴奏（ピアノ/ベース/
      オルガン/ギター/ストリングス）を、サンプル音源(smplr Soundfont)で鳴らす。
    ・音源の出力は「永続 voiceOut ノード」へ集約し、再生セッションごとに作り直される
      バス(makeBuses)へ startPlay 側から付け外しする（下の connectSmplr/disconnectSmplr）。
    ・打楽器(drKick/drSnare/drHat)・メトロノーム・チューナー音は従来のシンセのまま
      （このモジュールは扱わない）。

  設計上の要点
    ・smplr 楽器は生成時に destination を固定するため、ephemeral なバスへ直結すると
      次の startPlay でバスが作り直された瞬間に無音化する。そこで AudioContext と同じ寿命の
      voiceOut(lead/chord/bass) を挟み、バスの生成/破棄に追従して結線し直す。
    ・サンプル系メロディは lead バスの整形EQ（サワトゥースを胴っぽく見せる用）を避け、
      EQ後の合流点(buses.leadS)へ流す＝本来の音色を保つ。
    ・音源やサンプルが未ロードのあいだ、または軽量モード(ST.lite)では sfReady()=false を返し、
      synth.js 側が従来のオシレータ音源へフォールバックする（無音や遅延を作らない）。
    ・smplr 本体とサンプルはいずれも自前ホスト(/vendor 配下)。パスは import.meta.url 基準で
      解決するので配置ルートに依存しない。
*/

import { ST } from '../state.js';
import { audio } from './context.js';

/* 自前ホストの smplr 本体とサウンドフォント（配置ルート非依存で解決） */
const SMPLR_URL = new URL('../../vendor/smplr/index.mjs', import.meta.url).href;
const SF_BASE   = new URL('../../vendor/soundfonts/FluidR3_GM/', import.meta.url).href;
function sfUrl(name){ return SF_BASE + name + '-mp3.js'; }

/* 現在のページの楽器（PHP が window.APP / window.INSTRUMENT に出力） */
const LEAD_SET = { violin:1, viola:1, cello:1, contrabass:1 };
function leadName(){
  try{
    if(window.APP && window.APP.instrument && LEAD_SET[window.APP.instrument]) return window.APP.instrument;
    if(window.INSTRUMENT && window.INSTRUMENT.id && LEAD_SET[window.INSTRUMENT.id]) return window.INSTRUMENT.id;
  }catch(e){}
  return 'cello';
}

/* 各ボイスの音量(smplr の 0..127)。最終的な音量はこの値 × バスゲイン × マスターで決まる。
   バランス調整はまずここを触る。 */
const CAL = { lead:100, piano:92, bass:105, organ:82, guitar:96, strings:82 };

/* voiceOut は AudioContext と同じ寿命。バスの生成/破棄に追従して付け外しする。 */
let vout = null;                       // { lead, chord, bass }
let Smplr = null;                      // 動的 import した smplr モジュール
let booting = null;                    // 初期化(import＋常用ボイス生成)の進行 Promise

const INST   = { lead:null, piano:null, bass:null, organ:null, guitar:null, strings:null };
const LOADED = { lead:false, piano:false, bass:false, organ:false, guitar:false, strings:false };

function ensureVout(ctx){
  if(vout) return vout;
  const mk=()=>{ const n=ctx.createGain(); n.gain.value=1; return n; };
  vout = { lead:mk(), chord:mk(), bass:mk() };
  return vout;
}

function makeSF(ctx, name, dest, volume){
  return Smplr.Soundfont(ctx, { instrumentUrl: sfUrl(name), destination: dest, volume });
}

/* 常用ボイス（メロディ＋ピアノ＋ベース）を生成し、読み込みを開始する。
   同期部分（audio()/ensureVout）は呼び出し直後に実行されるので、直後の connectSmplr で
   voiceOut を確実に拾える（await import より前に voiceOut を用意しておく）。 */
export function ensureInstruments(){
  if(booting) return booting;
  booting = (async()=>{
    const ctx = audio();
    ensureVout(ctx);
    if(!Smplr) Smplr = await import(SMPLR_URL);
    if(!INST.lead){
      INST.lead = makeSF(ctx, leadName(), vout.lead, CAL.lead);
      INST.lead.load.then(()=>{ LOADED.lead=true; }).catch(()=>{});
    }
    if(!INST.piano){
      INST.piano = makeSF(ctx, 'acoustic_grand_piano', vout.chord, CAL.piano);
      INST.piano.load.then(()=>{ LOADED.piano=true; }).catch(()=>{});
    }
    if(!INST.bass){
      INST.bass = makeSF(ctx, 'acoustic_bass', vout.bass, CAL.bass);
      INST.bass.load.then(()=>{ LOADED.bass=true; }).catch(()=>{});
    }
  })();
  return booting;
}

/* 伴奏の追加音色（オルガン/ギター/ストリングス）は曲がそれを要求したときだけ遅延生成する。
   生成〜ロード完了まではシンセにフォールバックする（synth.js 側が sfReady で判定）。 */
function lazyVoice(key, name, busKey, vol){
  if(INST[key]) return;
  if(!Smplr || !vout){ ensureInstruments().then(()=> lazyVoice(key, name, busKey, vol)); return; }
  const ctx = audio();
  INST[key] = makeSF(ctx, name, vout[busKey], vol);
  INST[key].load.then(()=>{ LOADED[key]=true; }).catch(()=>{});
}
export function ensureOrgan(){   lazyVoice('organ',   'drawbar_organ',         'chord', CAL.organ);   }
export function ensureGuitar(){  lazyVoice('guitar',  'acoustic_guitar_nylon',  'chord', CAL.guitar);  }
export function ensureStrings(){ lazyVoice('strings', 'string_ensemble_1',      'chord', CAL.strings); }

/* synth.js 用：そのボイスが今サンプルで鳴らせるか（軽量モードでは常に false＝シンセを使う） */
export function sfReady(key){ return !ST.lite && LOADED[key] && !!INST[key]; }
export function sfInst(key){ return INST[key]; }

/* メロディ弦ごとの「実際に音が入っているサンプルの最高音（MIDI）」。
   FluidR3 のサウンドフォントは、コントラバスだけ A3(57) より上が“無音サンプル”に
   なっており、そのまま smplr で鳴らすと高音（1弦の親指ポジション等）が出ない。
   ここに上限を決めておき、それより高い音はサンプルを使わず synth.js のオシレータ音源へ
   回す（＝高音が無音になるのを防ぐ）。上限を持たない楽器（cello/viola/violin）は
   全音域でサンプルが鳴るので登録しない＝従来どおりサンプルを使う。 */
const LEAD_SAMPLE_MAX = { contrabass: 57 };   /* A3。これより上はオシレータ音源へ */
export function leadNoteSampled(midi){
  const cap = LEAD_SAMPLE_MAX[leadName()];
  return (cap == null) ? true : (midi <= cap);
}

/* startPlay 側から：作り直したバスへ voiceOut を結線する（古い結線は掃除してから繋ぎ直す）。 */
export function connectSmplr(buses){
  if(!vout || !buses) return;
  try{ vout.lead.disconnect();  }catch(e){}
  try{ vout.chord.disconnect(); }catch(e){}
  try{ vout.bass.disconnect();  }catch(e){}
  try{ vout.lead.connect(buses.leadS || buses.lead); }catch(e){}
  try{ vout.chord.connect(buses.chord); }catch(e){}
  try{ vout.bass.connect(buses.bass);  }catch(e){}
}
/* stopPlay 側は master フェード→切断で smplr 系も一緒に減衰するため通常は不要だが、
   明示的に切りたい場合のために用意（現状は未使用でも安全）。 */
export function disconnectSmplr(){
  if(!vout) return;
  try{ vout.lead.disconnect();  }catch(e){}
  try{ vout.chord.disconnect(); }catch(e){}
  try{ vout.bass.disconnect();  }catch(e){}
}
