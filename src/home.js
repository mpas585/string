/*
  home.js — 楽器選択トップ（/{言語}/）のエントリ。

  アプリ本体の main.js は指板・音声・譜面の要素が揃っている前提なのでトップでは読めない。
  ここで配線するのは会員まわり（ログイン／新規登録）と PWA だけ。
  要素IDはアプリ本体と同じにしてあるので、src/account.js はそのまま共用できる。
*/
import { on, closeDockModal } from './dom.js';
import { initAccount, openAccount, submitAccount, swapAccountMode, logoutAccount } from './account.js';
import './pwa.js';   /* Service Worker 登録と「ホーム画面に追加」。配線は pwa.js 側で完結 */

on('accBtn','click', openAccount);
on('accOut','click', logoutAccount);
on('accSubmit','click', submitAccount);
on('accSwap','click', swapAccountMode);
on('accPin','keydown',  e=>{ if(e.key==='Enter') submitAccount(); });
on('accNick','keydown', e=>{ if(e.key==='Enter') document.getElementById('accPin').focus(); });

on('dockScrim','click', closeDockModal);
document.querySelectorAll('[data-dkclose]').forEach(b=> b.addEventListener('click', closeDockModal));

/* ログイン状態を取りに行って表示を差し替える */
initAccount();
