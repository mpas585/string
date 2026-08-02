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
  clearPlayAttn();
}

/* ===== 「✓ 保存しました」が出たあいだ ▶ を前面へ =====
   設定を変えた＝譜面に反映して聴き直したい場面。パネルを ✕ で閉じなくても
   ▶ を押せるように、body のクラスで重なり順を上げる（CSS: body.save-attn .fab）。

   ・付ける … src/account.js の settingsChanged()（設定を変えた時点）と
              flashSaved()（「✓ 保存しました」が出た時点）の2か所
   ・外す … ドロワー／歯車／ドックのモーダルを閉じたとき
   ▶ を押した時点では外さない。押した直後は ■（停止）になるので、
   ここで重なり順を戻すとスクリムの下に沈んで止められなくなるため。
   ※ ▶ が無い画面（楽器選択トップ）では何もしない。 */
export function raisePlayAttn(){
  const fab=document.getElementById('fab');
  if(!fab || fab.disabled) return;
  /* 何も開いていなければ ▶ はもともと押せる。前へ出す必要も光らせる必要もない
     （保存の合図はパネルを閉じたあとに届くこともあるので、ここで見送る） */
  const open = document.getElementById('drawer')?.classList.contains('open')
            || document.getElementById('gearPanel')?.classList.contains('open')
            || document.getElementById('dockScrim')?.classList.contains('open');
  if(!open) return;
  document.body.classList.add('save-attn');
  /* 重なり順はここで直接付ける。styles.css にも同じ 62 を書いてあるが、
     CSS はブラウザや Service Worker のキャッシュで古いままになることがあり、
     それだと ▶ が .dkscrim(42)・.dkmodal(43) の下に沈んだままになるため。
     updateChrome() が fab.style.display を触っているのと同じやり方。 */
  fab.style.zIndex='62';
}
export function clearPlayAttn(){
  document.body.classList.remove('save-attn');
  const fab=document.getElementById('fab');
  if(fab) fab.style.zIndex='';     /* styles.css の既定（6）へ戻す */
}

/* ===== 画面キーボードよけ =====
   スマホでパスワードなどを打つと下からキーボードがせり上がり、
   画面のまん中に置いたモーダル（#mAcc / #mContact）が隠れてしまう。

   position:fixed はキーボードが出ても縮まない「レイアウトビューポート」を基準にするので、
   CSS だけでは避けられない。実際に見えている範囲は visualViewport が教えてくれるので、
   その高さと上端を CSS 変数にして body へ渡し、あとは styles.css 側で位置を決める。

     --vvh … いま見えている高さ
     --vvt … 見えている範囲の上端（ページを押し上げるブラウザだとここがずれる）
     body.kbd … キーボードが出ていると判断した状態

   visualViewport が無いブラウザ（古い端末）では何もしない。
   その場合もこれまでどおり中央に出るだけで、壊れはしない。 */
(function watchKeyboard(){
  const vv = window.visualViewport;
  if (!vv) return;
  let raf = 0;
  const apply = () => {
    raf = 0;
    const st = document.body.style;
    st.setProperty('--vvh', vv.height + 'px');
    st.setProperty('--vvt', (vv.offsetTop || 0) + 'px');
    /* 見えている高さが窓の 3/4 を切ったらキーボードが出ていると見なす。
       アドレスバーの伸び縮み（せいぜい1割程度）では反応しない値にしてある。 */
    document.body.classList.toggle('kbd', vv.height < window.innerHeight * 0.75);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  apply();
})();
