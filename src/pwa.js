/*
  pwa.js — Service Worker の登録と「ホーム画面に追加」の導線。

  ※ このファイルだけは【自分で配線する】。
     アプリ本体（main.js 経由）と 楽器選択トップ（/{言語}/）の両方から読まれるため、
     main.js の配線に載せられない。他モジュールにも依存させないこと。

  ・Service Worker は https（と localhost）でのみ動く。実体は ルート直下の sw.js。
  ・Android/Chrome は beforeinstallprompt を拾えたときだけ「ホーム画面に追加」を出す。
  ・iOS は API が無いので、共有メニューからの手順を文字で案内するだけにする。
*/
const ROOT = new URL('../', import.meta.url);          /* /src/ の1つ上＝サイトのルート */
const $ = (id) => document.getElementById(id);

/* window.T（PHP が出力する辞書）から引く。トップページなど辞書が無い場合は既定文を使う */
function tx(key, dflt) {
  const T = (typeof window !== 'undefined' && window.T) ? window.T : null;
  if (!T) return dflt;
  const v = key.split('.').reduce((o, k) => (o && o[k] != null) ? o[k] : null, T);
  return (typeof v === 'string') ? v : dflt;
}

/* ===== Service Worker ===== */
const canSW = ('serviceWorker' in navigator)
           && (location.protocol === 'https:' || location.hostname === 'localhost');
if (canSW) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', ROOT).href, { scope: ROOT.pathname })
      .catch((err) => console.warn('[string] Service Worker を登録できませんでした', err));
  });
}

/* ===== ホーム画面に追加 ===== */
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches)
                || (navigator.standalone === true);
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

let deferred = null;

function showBox(on) { const b = $('pwaBox');  if (b) b.hidden = !on; }
function showNote(text) {
  const n = $('pwaNote');
  if (!n) return;
  if (text) n.textContent = text;
  n.hidden = false;
}

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  deferred = ev;
  if (standalone) return;
  showBox(true);
  showNote('');
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  showBox(false);
  const n = $('pwaNote'); if (n) n.hidden = true;
});

if ($('pwaInstall')) {
  $('pwaInstall').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) { /* 閉じられただけ */ }
    deferred = null;
    showBox(false);
  });
}

/* iOS は追加のAPIが無い。すでにホームから起動していれば何も出さない */
if (isIOS && !standalone) {
  showNote(tx('ui.install_ios', '共有ボタン →「ホーム画面に追加」でアプリのように使えます'));
}
