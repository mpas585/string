/*
  home.js — 楽器選択トップ（/{言語}/）のエントリ。

  アプリ本体の main.js は指板・音声・譜面の要素が揃っている前提なのでトップでは読めない。
  ここで配線するのはアカウントまわりと PWA だけ。
  要素IDはアプリ本体と同じにしてあるので、src/account.js はそのまま共用できる。

  ※ トップには変える設定が無いので、復元後の再描画（setSaveApply）は登録しない。
     降ろした設定は LocalStorage に入るので、そのままアプリ本体へ持ち込まれる。
*/
import { on, closeDockModal } from './dom.js';
import { initAccount, openAccount, showSignin, showMe, showSignup, showForgot, showPasswd, showDelete, togglePassword,
         doLogin, doSignup, doResend, doForgot, doPasswd, doLogout, doDestroy, googleSignin,
         askLogin, askSkip } from './account.js';
import './pwa.js';   /* Service Worker 登録と「ホーム画面に追加」。配線は pwa.js 側で完結 */

on('svBtn','click', openAccount);
on('acLogin','click',  doLogin);
on('acSignup','click', doSignup);
on('acResend','click', doResend);
on('acForgot','click', doForgot);
on('acPasswd','click', doPasswd);
on('acLogout','click', doLogout);
on('acDestroy','click', doDestroy);
on('acGoogle','click', googleSignin);
on('acGoogleSu','click', googleSignin);
on('acToForgot','click',  showForgot);
on('acToPasswd','click',  showPasswd);
on('acToDestroy','click', showDelete);
/* タブ（ログイン ⇄ 新規登録）とパスワードの目マーク。
   どちらもボタンが複数あるので、#mAcc に一度だけ付けて中で振り分ける。 */
const mAcc = document.getElementById('mAcc');
if (mAcc) mAcc.addEventListener('click', e => {
  const tab = e.target.closest('.actab');
  if (tab) { tab.dataset.actab === 'signup' ? showSignup() : showSignin(); return; }
  const eye = e.target.closest('.pweye');
  if (eye) { togglePassword(eye); return; }
  const back = e.target.closest('[data-acback]');
  if (back) { back.dataset.acback === 'me' ? showMe() : showSignin(); }
});
on('acEmail','keydown',  e=>{ if(e.key==='Enter') doLogin(); });
on('acPass','keydown',   e=>{ if(e.key==='Enter') doLogin(); });
on('acSuEmail','keydown',e=>{ if(e.key==='Enter') doSignup(); });
on('acSuPass','keydown', e=>{ if(e.key==='Enter') doSignup(); });
on('acFoEmail','keydown',e=>{ if(e.key==='Enter') doForgot(); });
on('acPwNext','keydown', e=>{ if(e.key==='Enter') doPasswd(); });
on('acAskYes','click', askLogin);
on('acAskNo','click',  askSkip);

on('dockScrim','click', closeDockModal);
document.querySelectorAll('[data-dkclose]').forEach(b=> b.addEventListener('click', closeDockModal));

/* ログイン状態を取りに行く（入っていれば設定も降りてくる） */
initAccount();
