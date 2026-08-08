/*
  favorites.js — お気に入りの曲。

  ・付け外しは指板の左上のハート（#favBtn）。曲を読み込んでいるときだけ出る。
  ・付けた曲は曲一覧のボタンの右端にハートが付く（描くのは src/songs.js の renderSongList）。
  ・「曲を選ぶ」の右にある ❤お気に入り（#favOnly）で、一覧をお気に入りだけに絞れる。

  保存先は localStorage の 'cf:fav:v1'。'cf:' で始まるキーなので、ログインしていれば
  src/account.js が設定といっしょにサーバへ預かる（＝別の端末でも同じお気に入りが出る）。
  曲は楽器をまたいで同じものなので、設定や運指のように楽器別（cf:cello: …）にはしない。

  依存: state(ST), util(tt), drawer(Store), account(settingsChanged)。
*/
import { ST } from './state.js';
import { tt } from './util.js';
import { Store } from './drawer.js';
import { settingsChanged } from './account.js';

export const FAV_KEY = 'cf:fav:v1';

/* 読み出すたびに JSON を解くのは無駄なので手元に持つ。
   サーバから設定が降りてきたときは中身が入れ替わるので reloadFavs() で捨てる。 */
let FAV = null;

function load(){
  if(FAV) return FAV;
  FAV = new Set();
  try{
    const raw = Store.get(FAV_KEY);
    if(raw){
      const a = JSON.parse(raw);
      if(Array.isArray(a)) a.forEach(k=>{ if(typeof k === 'string' && k) FAV.add(k); });
    }
  }catch(e){ /* 壊れていたら空から始める */ }
  return FAV;
}

/* 他端末の設定を降ろした後に呼ぶ（src/main.js の setSaveApply） */
export function reloadFavs(){ FAV = null; }

export function isFav(key){ return !!key && load().has(String(key)); }
export function favCount(){ return load().size; }

export function toggleFav(key){
  if(!key) return false;
  const s = load(), k = String(key);
  if(s.has(k)) s.delete(k); else s.add(k);
  try{ Store.set(FAV_KEY, JSON.stringify(Array.from(s))); }catch(e){}
  settingsChanged();                      /* 保存の出口は1つ。ここからサーバへ知らせる */
  return s.has(k);
}

/* いま読み込んでいる譜面の、お気に入りとしてのキー。
   曲一覧のキー（src/songs.js の songEntries）と同じ形に揃える。
     'song:sakura' → 'sakura'      … あらかじめ用意した曲
     'share:12'    → 'sh:12'       … みんなの曲
     'up:12'       → 'up:12'       … 自分がアップロードした譜面（そのまま使う）
   読み込んだファイルなど、一覧に無いものは対象外（null を返す＝ハートを出さない）。 */
export function favKeyOfScore(scoreName){
  const s = String(scoreName || '');
  if(s.indexOf('song:')  === 0) return s.slice(5);
  if(s.indexOf('share:') === 0) return 'sh:' + s.slice(6);
  if(s.indexOf('up:')    === 0) return s;
  return null;
}

/* 指板の左上のハート。曲が変わるたびに src/modes.js の setScore から呼ばれる */
export function syncFavBtn(){
  const b = document.getElementById('favBtn');
  if(!b) return;
  const key = favKeyOfScore(ST.scoreName);
  if(!key){ b.hidden = true; return; }
  const on = isFav(key);
  b.hidden = false;
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', tt(on ? 'ui.fav_del' : 'ui.fav_add'));
  b.textContent = on ? '\u2764' : '\u2661';
}

/* 押されたら付け外しする。戻り値は付けたかどうか（表示の切り替えは呼び出し側） */
export function toggleFavCurrent(){
  const key = favKeyOfScore(ST.scoreName);
  if(!key) return null;
  return toggleFav(key);
}

/* 「曲を選ぶ」の右の ❤お気に入り。押されたときの見た目の切り替え。
   絞り込んでいるかどうかを持っているのは src/songs.js（一覧を作る側） */
export function syncFavFilterBtn(on){
  const b = document.getElementById('favOnly');
  if(!b) return;
  b.classList.toggle('on', !!on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
