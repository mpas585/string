/*
  account.js — 簡易会員（ニックネーム＋暗証番号4桁）のフロント側。
  サーバは api/auth.php（実処理は includes/auth.php・保存は SQLite）。

  ページのHTMLはログイン状態を含まない（PHP 側でセッションを開かない＝キャッシュ可能なまま）ので、
  読み込み後にここで状態を取りに行き、歯車パネルの表示だけ差し替える。
  画面は #mAccount（ログイン／新規登録の切替は同じフォームで行う）。
*/
import { tt } from './util.js';
import { toast } from './dom.js';
import { openDockModal, closeDockModal } from './drawer.js';

const API  = new URL('../api/auth.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';
const $ = (id) => document.getElementById(id);

let ME   = null;        /* ログイン中なら {nick} */
let MODE = 'login';     /* 'login' | 'register' */
let busy = false;

/* ===== 通信 ===== */
async function call(action, data = {}) {
  const body = new URLSearchParams(Object.assign({ action, lang: LANG }, data));
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'fetch' },
    body, credentials: 'same-origin', cache: 'no-store',
  });
  return res.json();
}

/* ===== 表示 ===== */
function syncUI() {
  const who = $('accWho'), inBtn = $('accBtn'), outBtn = $('accOut');
  if (who)    who.textContent = ME ? tt('ui.acc_hello', ME.nick) : tt('ui.acc_guest');
  if (who)    who.classList.toggle('on', !!ME);
  if (inBtn)  inBtn.hidden  = !!ME;
  if (outBtn) outBtn.hidden = !ME;
}

function setMsg(text, isErr) {
  const el = $('accMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}

function setMode(m) {
  MODE = (m === 'register') ? 'register' : 'login';
  const submit = $('accSubmit'), swap = $('accSwap'), pin = $('accPin');
  if (submit) submit.textContent = tt(MODE === 'login' ? 'account.login' : 'account.register');
  if (swap)   swap.textContent   = tt(MODE === 'login' ? 'account.to_register' : 'account.to_login');
  if (pin)    pin.setAttribute('autocomplete', MODE === 'login' ? 'current-password' : 'new-password');
  setMsg('');
}

/* ===== 操作（配線は main.js） ===== */
export function openAccount() {
  setMode('login');
  const nick = $('accNick'), pin = $('accPin');
  if (pin) pin.value = '';
  if (nick && ME) nick.value = ME.nick;
  openDockModal('mAccount');
  if (nick) setTimeout(() => nick.focus(), 60);
}

export function swapAccountMode() {
  setMode(MODE === 'login' ? 'register' : 'login');
}

export async function submitAccount() {
  if (busy) return;
  const nick = ($('accNick') ? $('accNick').value : '').trim();
  const pin  = ($('accPin')  ? $('accPin').value  : '').trim();

  /* サーバでも同じ検証をしているが、往復させずに気づけるようにここでも見る */
  if (!nick || !pin)          { setMsg(tt('account.err.empty'), true); return; }
  if (!/^[0-9]{4}$/.test(pin)){ setMsg(tt('account.err.pin'),   true); return; }

  busy = true;
  setMsg('');
  try {
    const r = await call(MODE, { nick, pin });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('account.err.server'), true); return; }
    ME = r.user;
    syncUI();
    closeDockModal();
    toast(r.message || '');
  } catch (e) {
    setMsg(tt('account.err.offline'), true);
  } finally {
    busy = false;
  }
}

export async function logoutAccount() {
  if (busy) return;
  busy = true;
  try {
    const r = await call('logout');
    ME = null;
    syncUI();
    toast((r && r.message) || '');
  } catch (e) {
    toast(tt('account.err.offline'));
  } finally {
    busy = false;
  }
}

/* 起動時：ログイン状態を取りに行く。通信できなくても画面は動かす */
export async function initAccount() {
  try {
    const res = await fetch(API + '?action=me&lang=' + encodeURIComponent(LANG),
                            { credentials: 'same-origin', cache: 'no-store' });
    const r = await res.json();
    ME = (r && r.ok) ? r.user : null;
  } catch (e) {
    ME = null;
  }
  syncUI();
  setMode('login');
}
