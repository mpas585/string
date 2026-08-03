/*
  contact.js — お問い合わせフォームのフロント側。送信先は api/contact.php。
  画面は歯車パネルのサブメニュー（.gp-page[data-gp="contact"]）。
  宛先アドレスと件名の組み立てはサーバ側（config/app.php の contact_to）。
*/
import { tt } from './util.js';
import { toast } from './dom.js';
import { openGearPage } from './drawer.js';

const API  = new URL('../api/contact.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';
const $ = (id) => document.getElementById(id);

let busy = false;

function setMsg(text, isErr) {
  const el = $('ctMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}

export function openContact() {
  setMsg('');
  openGearPage('contact');
  const n = $('ctName');
  if (n) setTimeout(() => n.focus(), 60);
}

export async function sendContact() {
  if (busy) return;
  const name = ($('ctName') ? $('ctName').value : '').trim();
  const mail = ($('ctMail') ? $('ctMail').value : '').trim();
  const body = ($('ctBody') ? $('ctBody').value : '').trim();
  const trap = ($('ctSite') ? $('ctSite').value : '');

  if (!name || !body) { setMsg(tt('contact.err.empty'), true); return; }

  busy = true;
  const btn = $('ctSend');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = tt('contact.sending'); }
  setMsg('');

  try {
    const params = new URLSearchParams({
      lang: LANG, name, email: mail, body, website: trap, page: location.href,
    });
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'fetch' },
      body: params, credentials: 'same-origin', cache: 'no-store',
    });
    const r = await res.json();
    if (!r || !r.ok) { setMsg((r && r.message) || tt('contact.err.send'), true); return; }

    /* 送信できたら中身を消して一覧へ戻す（二重送信よけも兼ねる） */
    if ($('ctBody')) $('ctBody').value = '';
    openGearPage('main', true);
    toast(r.message || tt('contact.ok'));
  } catch (e) {
    setMsg(tt('contact.err.offline'), true);
  } finally {
    busy = false;
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
