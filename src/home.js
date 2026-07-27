/*
  home.js — 楽器選択トップ（/{言語}/）のエントリ。

  アプリ本体の main.js は指板・音声・譜面の要素が揃っている前提なのでトップでは読めない。
  ここで配線するのは保存番号まわりと PWA だけ。
  要素IDはアプリ本体と同じにしてあるので、src/account.js はそのまま共用できる。

  ※ トップには変える設定が無いので、復元後の再描画（setSaveApply）は登録しない。
     読み込んだ設定は LocalStorage に入るので、そのままアプリ本体へ持ち込まれる。
*/
import { on, closeDockModal } from './dom.js';
import { initSave, openSave, createSave, loadSave, toggleSaveLoad, copySaveCode, unlinkSave, deleteSave, askCreate, askSkip } from './account.js';
import './pwa.js';   /* Service Worker 登録と「ホーム画面に追加」。配線は pwa.js 側で完結 */

on('svBtn','click', openSave);
on('svCreate','click', createSave);
on('svCopy','click', copySaveCode);
on('svLoadOpen','click', toggleSaveLoad);
on('svLoad','click', loadSave);
on('svUnlink','click', unlinkSave);
on('svDelete','click', deleteSave);
on('svInput','keydown', e=>{ if(e.key==='Enter') loadSave(); });
on('svAskYes','click', askCreate);
on('svAskNo','click',  askSkip);

on('dockScrim','click', closeDockModal);
document.querySelectorAll('[data-dkclose]').forEach(b=> b.addEventListener('click', closeDockModal));

/* 保存番号を持っていれば設定を取りに行く */
initSave();
