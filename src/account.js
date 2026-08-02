/*
  account.js — メールアドレス＋パスワードのログインと、設定のサーバ保存（フロント側）。
  サーバは api/account.php（実処理は includes/account.php・保存は SQLite）。

  旧「保存番号（英字1文字＋数字4桁）」は廃止した。番号を打つ画面はもう無い。

    ・ログインしていなくても全機能を使える（設定は端末の LocalStorage に残る）
    ・保存が要る操作（テンポ・指番号・運指・その他の設定）で初めてログインを勧める
    ・ログイン中は、変更のたびにサーバへ上書き（右下に「✓ 保存しました」）
    ・別の端末では同じメールアドレスでログインすれば設定が降りてくる
    ・Google ログインは config/app.php に client_id/secret が入っているときだけボタンを出す

  画面は #mAcc（ログイン・登録・再発行・アカウント）と #mAccAsk（保存しますか？）。
  要素IDはアプリ本体と楽器選択トップで同じにしてあるので、このファイルを両方でそのまま共用している。

  ※ 預けるのは localStorage の 'cf:' で始まるキー（設定・運指）そのもの。
     drawer.js の Store と同じ場所を読むので、保存する項目を増やしても手を入れなくてよい。
     localStorage が使えない環境（プライベートモード等）ではサーバ保存だけ黙って止まる。
  ※ メールアドレス・パスワードは localStorage に置かない。ログイン状態はサーバのセッション
     （HttpOnly の Cookie）だけが持つ＝JS からは読めない。
*/
import { tt } from './util.js';
import { toast, openDockModal, closeDockModal, raisePlayAttn } from './dom.js';

const API  = new URL('../api/account.php', import.meta.url).href;
const OAUTH_GOOGLE = new URL('../oauth/google.php', import.meta.url).href;
const LANG = (window.APP && window.APP.lang) || 'ja';
const $ = (id) => document.getElementById(id);

const PREFIX    = 'cf:';            /* 預ける対象のキー */
const SELF      = 'cf:save:';       /* 旧・保存番号まわりの残骸は預けない */
const MAX_BYTES = 512000;           /* サーバ側 ACC_MAX_BYTES と合わせる */
const SAVE_WAIT = 600;              /* 変更が続いたときにまとめる待ち時間（ms） */
const PASS_MIN  = 8;                /* サーバ側 ACC_PASS_MIN と合わせる */

let USER     = null;    /* {email, hasPass, verified} / 未ログインは null */
let CSRF     = '';      /* api/account.php の action=state で受け取る */
let HAS_GOOGLE = false; /* Google ログインが使える設定になっているか */
let armed    = false;   /* 初期化が済むまで自動保存しない */
let applying = false;   /* 復元中の保存を止める */
let asked    = false;   /* この訪問で「保存しますか？」を出したか */
let busy     = false;
let timer    = 0;
let onApplied = null;   /* 復元後に画面を作り直す処理（アプリ本体だけが登録する） */
let onCode   = null;    /* ログイン状態が変わったときの通知先（src/uploads.js が登録する） */

/* ===== localStorage（使えない環境では設定の持ち回りだけ止める） ===== */
const LS = (() => {
  try { localStorage.setItem('__cf_s', '1'); localStorage.removeItem('__cf_s'); return localStorage; }
  catch (e) { return null; }
})();

/* ===== 通信 ===== */
async function call(action, data = {}) {
  const body = new URLSearchParams(Object.assign({ action, lang: LANG, csrf: CSRF }, data));
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'fetch' },
    body, credentials: 'same-origin', cache: 'no-store',
  });
  const j = await res.json();
  /* トークンが返ってきたら差し替える（ログイン・ログアウトでセッションが変わる） */
  if (j && typeof j.csrf === 'string') CSRF = j.csrf;
  return j;
}

/* ===== 預けるデータ ===== */
/* 'cf:' で始まるキーをそのまま集める（設定・楽器別の運指を一括で持ち運べる） */
function collect() {
  const keys = {};
  if (!LS) return { v: 1, keys };
  try {
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (!k || k.indexOf(PREFIX) !== 0 || k.indexOf(SELF) === 0) continue;
      keys[k] = LS.getItem(k);
    }
  } catch (e) {}
  return { v: 1, keys };
}
/* 他端末の設定を降ろすときは「置換」する（混ざると設定の出所が分からなくなるため） */
function applyPayload(p) {
  if (!LS || !p || p.v !== 1 || !p.keys || typeof p.keys !== 'object') return false;
  try {
    const drop = [];
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (k && k.indexOf(PREFIX) === 0 && k.indexOf(SELF) !== 0) drop.push(k);
    }
    drop.forEach(k => LS.removeItem(k));
    for (const k of Object.keys(p.keys)) {
      const v = p.keys[k];
      if (k.indexOf(PREFIX) === 0 && k.indexOf(SELF) !== 0 && typeof v === 'string') LS.setItem(k, v);
    }
  } catch (e) { return false; }
  return true;
}
/* 復元を画面に反映する。反映の中身はアプリ本体だけが知っているので外から渡す */
function repaint() {
  if (!onApplied) return;
  applying = true;
  try { onApplied(); } catch (e) { console.warn('[string] 設定の復元に失敗しました', e); }
  applying = false;
}

/* ===== 表示 ===== */
/* 開くページは常に1枚だけ（歯車のサブメニューと同じ作法） */
function openPane(name) {
  const box = $('mAcc');
  if (!box) return;
  box.querySelectorAll('.acp').forEach(p => p.classList.toggle('on', p.dataset.acp === name));
  /* ログインと新規登録のときだけタブを出す。他のページでは行き先が違うので隠す */
  const tabs = $('acTabs');
  if (tabs) {
    const onTab = (name === 'signin' || name === 'signup');
    tabs.hidden = !onTab;
    tabs.querySelectorAll('.actab').forEach(t => {
      const on = t.dataset.actab === name;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  /* ページを移ったら、見せていたパスワードは伏せ字に戻す（置きっぱなしで覗かれないように） */
  hideAllPasswords();
  setMsg('');
  /* 最初の入力へ寄せる。スマホで勝手に拡大されないよう少し待つ */
  const first = box.querySelector('.acp.on input');
  if (first) setTimeout(() => { try { first.focus(); } catch (e) {} }, 60);
}

/* ===== パスワードの目マーク ===== */
/* 押すたびに伏せ字と平文を入れ替える。読み上げ用の説明文も一緒に差し替える */
export function togglePassword(btn) {
  const el = btn && $(btn.dataset.pweye);
  if (!el) return;
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  btn.classList.toggle('on', show);
  btn.setAttribute('aria-label', tt(show ? 'acc.pw_hide' : 'acc.pw_show'));
  /* 押したあともそのまま打ち続けられるように、文字の位置を末尾へ戻して入力欄に返す */
  try { const n = el.value.length; el.focus(); el.setSelectionRange(n, n); } catch (e) {}
}
function hideAllPasswords() {
  document.querySelectorAll('#mAcc .pweye.on').forEach(b => {
    const el = $(b.dataset.pweye);
    if (el) el.type = 'password';
    b.classList.remove('on');
    b.setAttribute('aria-label', tt('acc.pw_show'));
  });
}

function syncUI() {
  const who = $('svWho'), btn = $('svBtn');
  if (who) {
    who.textContent = USER ? tt('ui.acc_on', USER.email) : tt('ui.acc_none');
    who.classList.toggle('on', !!USER);
  }
  if (btn) btn.textContent = tt(USER ? 'ui.acc_open' : 'ui.acc_start');
  const me = $('acWho'); if (me) me.textContent = USER ? USER.email : '';
  /* Google ログインは設定が入っているときだけ出す */
  document.querySelectorAll('.acgoogle').forEach(el => { el.hidden = !HAS_GOOGLE; });
  /* Google だけで入っている人には「今のパスワード」を尋ねない */
  const pwNow = $('acPwNowRow');
  if (pwNow) pwNow.hidden = !(USER && USER.hasPass);
  /* パスワードを持たない人の退会では確認用パスワードを出さない */
  const dlPass = $('acDelPassRow');
  if (dlPass) dlPass.hidden = !(USER && USER.hasPass);
  /* ログイン状態に紐づく画面（アップロードした楽譜の一覧）へ知らせる。
     ログイン・ログアウト・起動時の復元はすべてここを通るので、配線はこの1か所でよい */
  if (onCode) { try { onCode(USER ? USER.email : null); } catch (e) {} }
}

/* ログイン中かどうか。譜面の保存（src/uploads.js）で使う */
export function isSignedIn() { return !!USER; }
/* 旧名。src/uploads.js が真偽で見ているだけなので、そのまま残してある */
export function getSaveCode() { return USER ? USER.email : null; }
/* api/scores.php へ渡すトークン */
export function getCsrf() { return CSRF; }
/* ログイン状態が変わったときの通知先を登録する（登録できるのは1つだけ） */
export function setSaveWatcher(fn) { onCode = fn; }

function setMsg(text, isErr) {
  const el = $('acMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}

/* 右下に「✓ 保存しました」を1秒ほど。要素はここで作る（ビューに置かせない） */
function flashSaved() {
  let el = $('svSaved');
  if (!el) {
    el = document.createElement('div');
    el.id = 'svSaved';
    el.className = 'svsaved';
    document.body.appendChild(el);
  }
  el.textContent = tt('acc.saved');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1100);
  raisePlayAttn();      /* 開いたままでも ▶ を押せるように前面へ（src/dom.js） */
}

/* ===== 自動保存 ===== */
function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!USER) return;
    const s = JSON.stringify(collect());
    if (s.length > MAX_BYTES) { toast(tt('acc.err.payload')); return; }
    try {
      const r = await call('push', { payload: s });
      if (r && r.ok) { flashSaved(); return; }
      /* セッションが切れていた（他の端末でパスワードを変えた等）。未ログインに戻す */
      if (r && r.error === 'needlogin') { USER = null; syncUI(); }
    } catch (e) { /* 通信できないときは次の変更でまた試す */ }
  }, SAVE_WAIT);
}

/* 設定・運指が変わったときに drawer.js から呼ばれる入口 */
export function settingsChanged() {
  if (!armed || applying) return;
  /* 変えた時点で ▶ を前面へ。サーバへの保存（＝「✓ 保存しました」）は
     600ms 待ってから通信するので、そこまで待つと反応が遅れる。
     ログインしていない人にも同じように効かせたいので、分岐の前で呼ぶ。 */
  raisePlayAttn();
  if (USER) { scheduleSave(); return; }
  if (asked || !LS) return;
  asked = true;                      /* 勧めるのは1回だけ。断られたらこの訪問では出さない */
  openDockModal('mAccAsk');
}

/* 初期化が済んだ合図。これより前の保存（音量の底上げ等）では勧めない */
export function armSave() { armed = true; }

/* 復元後に画面を作り直す処理を登録する（アプリ本体のみ） */
export function setSaveApply(fn) { onApplied = fn; }

/* ===== 画面を開く ===== */
export function openAccount() {
  syncUI();
  openPane(USER ? 'me' : 'signin');
  openDockModal('mAcc');
}
export function showSignin() { openPane('signin'); }
export function showMe()     { openPane('me'); }
export function showSignup() { openPane('signup'); }
export function showForgot() { openPane('forgot'); }
export function showPasswd() { openPane('passwd'); }
export function showDelete() { openPane('destroy'); }

/* Google ログインへ。戻り先はサーバ側が決める（oauth/google.php） */
export function googleSignin() {
  if (!HAS_GOOGLE) return;
  location.href = OAUTH_GOOGLE + '?lang=' + encodeURIComponent(LANG);
}

/* ===== 操作（配線は main.js / home.js） ===== */
function val(id) { const el = $(id); return el ? el.value.trim() : ''; }
function raw(id) { const el = $(id); return el ? el.value : ''; }
function clearPass() {
  ['acPass', 'acSuPass', 'acPwNow', 'acPwNext', 'acDelPass'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  hideAllPasswords();
}

export async function doLogin() {
  if (busy) return;
  const email = val('acEmail'), pass = raw('acPass');
  if (!email || !pass) { setMsg(tt('acc.err.signin'), true); return; }
  busy = true; setMsg('');
  try {
    const r = await call('login', { email, pass });
    if (!r || !r.ok) {
      setMsg((r && r.message) || tt('acc.err.server'), true);
      /* 確認が済んでいないアカウント。再送の入口を出す */
      if (r && r.error === 'unverified') {
        const el = $('acResendRow'); if (el) el.hidden = false;
        const se = $('acSuEmail'); if (se) se.value = email;
      }
      return;
    }
    clearPass();
    USER = r.user || null;
    /* サーバに設定があればそれで置き換える。無ければ、この端末の設定をそのまま上げる */
    if (r.payload && applyPayload(r.payload)) repaint();
    else scheduleSave();
    syncUI();
    closeDockModal();
    toast(r.message || '');
  } catch (e) { setMsg(tt('acc.err.offline'), true); }
  finally { busy = false; }
}

export async function doSignup() {
  if (busy) return;
  const email = val('acSuEmail'), pass = raw('acSuPass');
  if (!email) { setMsg(tt('acc.err.email'), true); return; }
  if (pass.length < PASS_MIN) { setMsg(tt('acc.err.password'), true); return; }
  busy = true; setMsg('');
  try {
    const r = await call('signup', { email, pass });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('acc.err.server'), true); return; }
    clearPass();
    openPane('sent');
    const el = $('acSentTo'); if (el) el.textContent = email;
  } catch (e) { setMsg(tt('acc.err.offline'), true); }
  finally { busy = false; }
}

export async function doResend() {
  if (busy) return;
  const email = val('acSuEmail') || val('acEmail');
  if (!email) { setMsg(tt('acc.err.email'), true); return; }
  busy = true; setMsg('');
  try {
    const r = await call('resend', { email });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('acc.err.server'), true); return; }
    setMsg(r.message || '', false);
  } catch (e) { setMsg(tt('acc.err.offline'), true); }
  finally { busy = false; }
}

export async function doForgot() {
  if (busy) return;
  const email = val('acFoEmail');
  if (!email) { setMsg(tt('acc.err.email'), true); return; }
  busy = true; setMsg('');
  try {
    const r = await call('forgot', { email });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('acc.err.server'), true); return; }
    openPane('sent');
    const el = $('acSentTo'); if (el) el.textContent = email;
  } catch (e) { setMsg(tt('acc.err.offline'), true); }
  finally { busy = false; }
}

export async function doPasswd() {
  if (busy) return;
  const now = raw('acPwNow'), next = raw('acPwNext');
  if (next.length < PASS_MIN) { setMsg(tt('acc.err.password'), true); return; }
  busy = true; setMsg('');
  try {
    const r = await call('passwd', { now, next });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('acc.err.server'), true); return; }
    clearPass();
    /* パスワードを持つようになったので表示を作り直す */
    if (USER) USER.hasPass = true;
    syncUI();
    openPane('me');
    toast(r.message || '');
  } catch (e) { setMsg(tt('acc.err.offline'), true); }
  finally { busy = false; }
}

export async function doLogout() {
  if (busy) return;
  busy = true; setMsg('');
  try {
    const r = await call('logout');
    USER = null;
    clearPass();
    asked = true;                    /* 出た直後に勧め直さない */
    syncUI();
    closeDockModal();
    toast((r && r.message) || '');
  } catch (e) { setMsg(tt('acc.err.offline'), true); }
  finally { busy = false; }
}

export async function doDestroy() {
  if (busy) return;
  if (!window.confirm(tt('acc.destroy_ask'))) return;
  busy = true; setMsg('');
  try {
    const r = await call('destroy', { pass: raw('acDelPass') });
    if (!r || !r.ok) { setMsg((r && r.message) || tt('acc.err.server'), true); return; }
    USER = null;
    clearPass();
    asked = true;
    syncUI();
    closeDockModal();
    toast(r.message || '');
  } catch (e) { setMsg(tt('acc.err.offline'), true); }
  finally { busy = false; }
}

/* 「設定を保存しますか？」の2つのボタン */
export function askLogin() { closeDockModal(); openAccount(); }
export function askSkip()  { closeDockModal(); }

/* ===== 起動時 =====
   ログイン状態とCSRFトークンをサーバに聞く。入っていれば設定を降ろす。
   通信できなくても画面は動かす（端末の設定のまま使える）。 */
export async function initAccount() {
  syncUI();
  try {
    const r = await call('state');
    if (!r || !r.ok) return;
    USER       = r.user || null;
    HAS_GOOGLE = !!r.google;
    syncUI();
    if (!USER) return;
    const p = await call('pull');
    if (p && p.ok && applyPayload(p.payload)) repaint();
  } catch (e) { /* オフライン。ローカルの設定のまま使う */ }
  /* Google から戻ってきた直後の知らせ（oauth/google.php が ?login= を付ける） */
  showOauthResult();
}

/* Google ログインの結果を1回だけ出して、URL から印を消す（履歴に残さない） */
function showOauthResult() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  const v = q.get('login');
  if (!v) return;
  if (v === 'ok') toast(tt('acc.ok.login'));
  else            toast(tt('acc.err.' + (v === 'oauth_cancel' ? 'oauth_cancel' : v === 'oauth_email' ? 'oauth_email' : 'oauth')));
  q.delete('login');
  const s = q.toString();
  try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) {}
}
