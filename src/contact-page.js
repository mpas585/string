/*
  contact-page.js — お問い合わせのページ（/{言語}/contact/）の送信まわり。

  アプリ本体の src/contact.js と同じ内容を api/contact.php へ送る（入力欄のIDも同じ）。
  別ファイルにしてあるのは、src/contact.js が歯車パネルを開く openGearPage() を使っており、
  そこから drawer.js → modes.js → 音まわり…と芋づるに読み込まれてしまうため。
  このページは指板もドロワーも持たないので、送信に要るぶんだけをここに置く。

  文言は includes/views/contact.php が window.T.contact に入れて渡す。
*/

const API  = new URL('../api/contact.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';
const DICT = (window.T && window.T.contact) || {};

const $ = (id) => document.getElementById(id);

/* 'err.empty' のような入れ子も引けるようにする。無ければキーをそのまま返す */
function tc(path) {
  let cur = DICT;
  for (const seg of String(path).split('.')) {
    if (!cur || typeof cur !== 'object' || !(seg in cur)) return path;
    cur = cur[seg];
  }
  return typeof cur === 'string' ? cur : path;
}

let busy = false;

function setMsg(text, isErr) {
  const el = $('ctMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}

function isTakedown() {
  return !!($('ctKind') && $('ctKind').value === 'takedown');
}

/* 種別（お問い合わせ／削除依頼）。削除依頼のときだけ曲名と理由の欄を出す。
   入れてもらうのはその2つで十分なので、お名前と内容はどちらも任意にしている。 */
function syncKind() {
  const box = $('ctTakedown');
  if (box) box.hidden = !isTakedown();
  setMsg('');
}

async function send() {
  if (busy) return;
  const name = ($('ctName') ? $('ctName').value : '').trim();
  const mail = ($('ctMail') ? $('ctMail').value : '').trim();
  const body = ($('ctBody') ? $('ctBody').value : '').trim();
  const trap = ($('ctSite') ? $('ctSite').value : '');
  const kind = isTakedown() ? 'takedown' : 'normal';
  const song   = ($('ctSong')   ? $('ctSong').value   : '').trim();
  const reason = ($('ctReason') ? $('ctReason').value : '').trim();

  /* 削除依頼は曲名と理由だけ、ふつうのお問い合わせはお名前と内容 */
  if (kind === 'takedown') {
    if (!song || !reason) { setMsg(tc('err.takedown'), true); return; }
  } else if (!name || !body) {
    setMsg(tc('err.empty'), true); return;
  }

  busy = true;
  const btn = $('ctSend');
  if (btn) { btn.disabled = true; btn.textContent = tc('sending'); }
  setMsg('');

  try {
    const params = new URLSearchParams({
      lang: LANG, name, email: mail, body, website: trap, page: location.href,
      kind, song, reason,
    });
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      body: params.toString(),
    });
    const j = await res.json();
    if (!j.ok) { setMsg(j.message || tc('err.send'), true); return; }

    setMsg(j.message || tc('ok'));
    /* 送信できたら中身を消す（二重送信よけも兼ねる） */
    if ($('ctBody'))   $('ctBody').value = '';
    if ($('ctSong'))   $('ctSong').value = '';
    if ($('ctReason')) $('ctReason').value = '';
  } catch (e) {
    setMsg(tc('err.send'), true);
  } finally {
    busy = false;
    if (btn) { btn.disabled = false; btn.textContent = tc('send'); }
  }
}

if ($('ctKind')) $('ctKind').addEventListener('change', syncKind);
if ($('ctSend')) $('ctSend').addEventListener('click', send);
syncKind();
