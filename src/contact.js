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
  syncKind();
  const n = $('ctName');
  if (n) setTimeout(() => n.focus(), 60);
}

/* 種別（お問い合わせ／削除依頼）。削除依頼のときだけ曲名と理由の欄を出す。
   入れてもらうのはその2つで十分なので、お名前と内容はどちらも任意にしている。 */
export function syncKind() {
  const box = $('ctTakedown');
  if (box) box.hidden = !isTakedown();
  setMsg('');
}
function isTakedown() {
  return !!($('ctKind') && $('ctKind').value === 'takedown');
}

export async function sendContact() {
  if (busy) return;
  const name = ($('ctName') ? $('ctName').value : '').trim();
  const mail = ($('ctMail') ? $('ctMail').value : '').trim();
  const body = ($('ctBody') ? $('ctBody').value : '').trim();
  const trap = ($('ctSite') ? $('ctSite').value : '');
  const kind = isTakedown() ? 'takedown' : 'normal';
  const song   = ($('ctSong')   ? $('ctSong').value   : '').trim();
  const reason = ($('ctReason') ? $('ctReason').value : '').trim();

  /* 削除依頼は曲名と理由だけ、ふつうのお問い合わせはこれまでどおりお名前と内容 */
  if (kind === 'takedown') {
    if (!song || !reason) { setMsg(tt('contact.err.takedown'), true); return; }
  } else if (!name || !body) {
    setMsg(tt('contact.err.empty'), true); return;
  }

  busy = true;
  const btn = $('ctSend');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = tt('contact.sending'); }
  setMsg('');

  try {
    const params = new URLSearchParams({
      lang: LANG, name, email: mail, body, website: trap, page: location.href,
      kind, song, reason,
    });
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'fetch' },
      body: params, credentials: 'same-origin', cache: 'no-store',
    });
    const r = await res.json();
    if (!r || !r.ok) { setMsg((r && r.message) || tt('contact.err.send'), true); return; }

    /* 送信できたら中身を消して一覧へ戻す（二重送信よけも兼ねる） */
    if ($('ctBody'))   $('ctBody').value = '';
    if ($('ctSong'))   $('ctSong').value = '';
    if ($('ctReason')) $('ctReason').value = '';
    openGearPage('main', true);
    toast(r.message || tt('contact.ok'));
  } catch (e) {
    setMsg(tt('contact.err.offline'), true);
  } finally {
    busy = false;
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
