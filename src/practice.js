/*
  practice.js — 練習した時間を数えて、日ごとに残す。

  数え方は「実際に鳴っていた時間」。
    ・再生中（またはメトロノームを鳴らしているあいだ）だけ増える。止めているあいだは増えない
    ・同じ小節を繰り返し練習すれば、その回数ぶん増える
    ・巻き戻しても減らない（かけた時間そのものを数えるため）

  やり方は ST.playing を1秒ごとに見にいくだけにしてある。
  再生の開始・停止・テンポ変更・シークはどれも ST.playing を通るので、
  scheduler.js に手を入れなくても取りこぼさない。
  （テンポを変えると startPlay が鳴らし直しに入るので、開始と終了を数えると二重になる）

  保存先は LocalStorage の 'cf:practice:v1'。'cf:' で始まるので
  account.js がそのままサーバーへ預けてくれる＝別の端末でも続きが見られる。

  日付は端末の時計のまま（現地時間）で数える。夜中の0時で日が変わる。
*/
import { ST } from './state.js';
import { tt } from './util.js';

export const PRACTICE_KEY = 'cf:practice:v1';

const TICK   = 1000;    /* 見にいく間隔（ms） */
const MAXGAP = 4000;    /* この間隔より長く空いたぶんは数えない（端末が眠っていた等） */
const MINDAY = 1;       /* この秒数に満たない日は記録に残さない */

let last  = 0;          /* 前回見にいった時刻 */
let timer = 0;
let onChange = null;    /* 数字が変わったときの知らせ先（画面の更新用） */

/* ===== LocalStorage（使えない環境では黙って何もしない） ===== */
const LS = (() => {
  try { localStorage.setItem('__cf_p', '1'); localStorage.removeItem('__cf_p'); return localStorage; }
  catch (e) { return null; }
})();

/* ===== 読み書き ===== */
/* 形: {v:1, days:{'2026-08-02': 秒数, …}} 
   累計は days を足して出す（別に持つと片方だけずれるため） */
function empty() { return { v: 1, days: {} }; }

export function load() {
  if (!LS) return empty();
  try {
    const j = JSON.parse(LS.getItem(PRACTICE_KEY) || 'null');
    if (!j || j.v !== 1 || typeof j.days !== 'object' || !j.days) return empty();
    return j;
  } catch (e) { return empty(); }
}
function save(d) {
  if (!LS) return;
  try { LS.setItem(PRACTICE_KEY, JSON.stringify(d)); } catch (e) {}
}

/* 端末の時計での 'YYYY-MM-DD'。toISOString は UTC になってしまうので使わない */
export function dayKey(dt) {
  const d = dt || new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ===== 集計 ===== */
export function totalSec(data) {
  const d = data || load();
  let n = 0;
  for (const k in d.days) n += d.days[k] || 0;
  return n;
}
export function daySec(key, data) {
  const d = data || load();
  return d.days[key] || 0;
}
export function activeDays(data) {
  const d = data || load();
  let n = 0;
  for (const k in d.days) if (d.days[k] >= MINDAY) n++;
  return n;
}
/* 年と月（月は1〜12）を渡すと、その月の合計 */
export function monthSec(year, month, data) {
  const d = data || load();
  const pre = year + '-' + (month < 10 ? '0' : '') + month + '-';
  let n = 0;
  for (const k in d.days) if (k.indexOf(pre) === 0) n += d.days[k] || 0;
  return n;
}

/* ===== 表示用の文字 ===== */
/* 1時間未満は「◯分」、1分未満は「◯秒」。長くなるほど細かい桁は落とす */
export function fmt(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60)   return tt('prac.sec', s);
  const m = Math.floor(s / 60);
  if (m < 60)   return tt('prac.min', m);
  const h = Math.floor(m / 60);
  return tt('prac.hm', h, m % 60);
}

/* ===== 記録 ===== */
/* 1秒ごとに呼ばれる。鳴っていたぶんだけ足す */
function tick() {
  const now = Date.now();
  const gap = now - last;
  last = now;
  /* 譜面の再生（ST.playing）と、メトロノーム（ST.metroOn）のどちらでも数える。
     メトロノームは譜面を読み込まずに使えるので、ST.playing だけ見ていると数え落とす。 */
  if (!ST.playing && !ST.metroOn) return;
  if (gap <= 0 || gap > MAXGAP) return;   /* 端末が眠っていた・タブが止まっていた */

  const d = load();
  const k = dayKey();
  d.days[k] = (d.days[k] || 0) + gap / 1000;
  save(d);
  if (onChange) { try { onChange(); } catch (e) {} }
}

/* 画面の数字を更新する処理を登録する（登録できるのは1つだけ） */
export function setPracticeWatcher(fn) { onChange = fn; }

export function initPractice() {
  if (timer) return;
  last = Date.now();
  timer = setInterval(tick, TICK);
  /* タブに戻ってきたときは、離れていたあいだを数えないように基準を引き直す */
  document.addEventListener('visibilitychange', () => { last = Date.now(); });
}

/* ===== 端末とサーバーの突き合わせ =====
   設定は「サーバーのもので置き換える」で構わないが、練習時間は消えると困る。
   同じ日に別の端末で練習していることもあるので、日ごとに大きいほうを採る。
   （足すと、同じ端末が二重に数えられたときに増えすぎる） */
export function mergePractice(localRaw, serverRaw) {
  const pick = raw => {
    try {
      const j = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      return (j && j.v === 1 && j.days) ? j : null;
    } catch (e) { return null; }
  };
  const a = pick(localRaw), b = pick(serverRaw);
  if (!a) return b ? JSON.stringify(b) : null;
  if (!b) return JSON.stringify(a);
  const out = { v: 1, days: {} };
  for (const k in a.days) out.days[k] = a.days[k] || 0;
  for (const k in b.days) out.days[k] = Math.max(out.days[k] || 0, b.days[k] || 0);
  return JSON.stringify(out);
}
