/*
  dom.js — DOM操作ヘルパ。元 cello-finger.html より無改変で移植。
    toast … L2733–2737
    on    … L3502–3507
  ※ 元コードは要素取得を document.getElementById 直書きで行っており、
    `$` 相当のヘルパは存在しない（新設しない）。
  ※ on() 定義の直後に並ぶ各種イベント配線（on('file',…) 等）は core には含めず、
    各機能の移植バッチでそのモジュールの init() に振り分ける。
*/

export function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'), 2600);
}

export function on(id, ev, fn){
  const el=document.getElementById(id);
  if(!el){ console.error(`[string] 要素 #${id} が見つかりません（${ev} を配線できません）`); return null; }
  el.addEventListener(ev, fn);
  return el;
}

/* ===== ドック上のモーダル（.dkmodal）の開閉 =====
   もとは drawer.js にあったが、楽器選択トップ（/{言語}/）からも会員モーダルを開くため、
   依存の無い dom.js へ移した。drawer.js からも従来どおり import できる（再輸出している）。 */
export function openDockModal(id){
  document.querySelectorAll('.dkmodal').forEach(m=> m.classList.toggle('open', m.id===id));
  const sc=document.getElementById('dockScrim'); if(sc) sc.classList.add('open');
}
export function closeDockModal(){
  document.querySelectorAll('.dkmodal').forEach(m=> m.classList.remove('open'));
  const sc=document.getElementById('dockScrim'); if(sc) sc.classList.remove('open');
}
