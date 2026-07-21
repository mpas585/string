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
