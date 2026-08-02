/*
  practice-ui.js — 累計練習時間の表示と、練習カレンダー（花丸）。

    ・歯車パネルのアカウントの中に「累計練習時間」を出す
    ・そこを押すとカレンダーが開く
    ・練習した日には花丸と、その日の練習時間が入る

  数えているのは practice.js。ここは見せ方だけを持つ。
*/
import { openDockModal } from './dom.js';
import { tt } from './util.js';
import { load, totalSec, daySec, monthSec, activeDays, dayKey, fmt, setPracticeWatcher } from './practice.js';

const $ = (id) => document.getElementById(id);

/* いま見ている月。開くたびに今月へ戻す */
let curY = 0, curM = 0;

/* ===== 歯車パネルの1行 ===== */
export function refreshPracticeLine() {
  const el = $('pracTotal');
  if (el) el.textContent = fmt(totalSec());
}

/* ===== カレンダー ===== */
/* 文言側は「日,月,火,…」のようにカンマ区切りで持たせてある */
function weekdays() {
  return String(tt('prac.wd')).split(',');
}
function monthName(m) {
  const a = String(tt('prac.months')).split(',');
  return a[m - 1] || String(m);
}

export function renderCalendar() {
  const box = $('pracCal');
  if (!box) return;
  const data = load();

  /* 見出し（◯年◯月）。並び順は言語ごとに違うので、文言側で %1$s / %2$s を入れ替える */
  const ttl = $('pracMonth');
  if (ttl) ttl.textContent = tt('prac.month_fmt', curY, monthName(curM));

  /* 集計の3つ */
  const all = $('pracSumAll'), mon = $('pracSumMon'), dys = $('pracSumDays');
  if (all) all.textContent = fmt(totalSec(data));
  if (mon) mon.textContent = fmt(monthSec(curY, curM, data));
  if (dys) dys.textContent = tt('prac.days_n', activeDays(data));

  const first = new Date(curY, curM - 1, 1);
  const lead  = first.getDay();                      /* 1日の前に置く空きマスの数（日曜始まり） */
  const len   = new Date(curY, curM, 0).getDate();   /* その月の日数 */
  const today = dayKey();

  let html = '<div class="pc-wd">' + weekdays().map(w => `<span>${w}</span>`).join('') + '</div><div class="pc-grid">';
  for (let i = 0; i < lead; i++) html += '<div class="pc-cell pad"></div>';
  for (let d = 1; d <= len; d++) {
    const k   = `${curY}-${curM < 10 ? '0' : ''}${curM}-${d < 10 ? '0' : ''}${d}`;
    const sec = daySec(k, data);
    const cls = 'pc-cell' + (sec >= 1 ? ' done' : '') + (k === today ? ' today' : '');
    html += `<div class="${cls}">`
         +    `<span class="pc-d">${d}</span>`
         +    (sec >= 1 ? `<span class="pc-mark">💮</span><span class="pc-t">${fmt(sec)}</span>` : '')
         +  '</div>';
  }
  html += '</div>';
  box.innerHTML = html;
}

export function openPractice() {
  const now = new Date();
  curY = now.getFullYear();
  curM = now.getMonth() + 1;
  renderCalendar();
  openDockModal('mPractice');
}
export function prevMonth() {
  curM--; if (curM < 1) { curM = 12; curY--; }
  renderCalendar();
}
export function nextMonth() {
  curM++; if (curM > 12) { curM = 1; curY++; }
  renderCalendar();
}

/* 起動時。数字が増えたら歯車の1行とカレンダーを追いかける */
export function initPracticeUI() {
  refreshPracticeLine();
  setPracticeWatcher(() => {
    refreshPracticeLine();
    /* カレンダーを開いたまま再生していることがあるので、開いていれば描き直す */
    const m = $('mPractice');
    if (m && m.classList.contains('open')) renderCalendar();
  });
}
