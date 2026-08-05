/*
  home-gallery.js — 言語別トップ（/{言語}/）の楽器選択。

  参考にした動き（cssscript の Interactive 3D Rotating Gallery）と同じ「カバーフロー」型。
  箱をぐるりと回す形だと、正面の1つしか見えず「ほかにも選べる」ことが伝わらないため、
  ・中央の楽器を大きく正面に
  ・その左右に、内側を向いて傾いた楽器を、奥へ小さく並べる
  という並べ方にして、4種すべてが同時に見えるようにしている。

  ・指で左右に払う（マウスならドラッグ）と、指に追いてまわり、離すと近い位置で止まる。
  ・中央の楽器を押すとその楽器のページへ。中央でないものを押したときは、
    進まずにその楽器を中央へ持ってくる（押し間違いを進行にしないため）。
  ・‹ › のボタン、下の丸、キーボードの ← → でも動く。
  ・端まで来たら止まる（一周しない）。いま何番目かが分かるようにするため。

  並んでいるのは includes/views/home.php が出した <a class="hm-card"> そのもの。
  JS が動かない環境では .hm-stage に .on が付かないので、これまでどおり
  縦に並んだリンク一覧として見える（中身は同じ <a> なのでリンクは生きる）。
*/

const stage = document.getElementById('hmStage');
const ring  = document.getElementById('hmRing');
const dots  = document.getElementById('hmDots');
const prevB = document.getElementById('hmPrev');
const nextB = document.getElementById('hmNext');

const cards = stage && ring ? Array.from(ring.querySelectorAll('.hm-card')) : [];
const N = cards.length;

const CAN_3D = typeof CSS !== 'undefined' && CSS.supports
  && CSS.supports('transform-style', 'preserve-3d');

/* 楽器が1つしかないときは並べる意味がないので、素の一覧のままにする */
if (stage && ring && N > 1 && CAN_3D) init();

function init() {
  /* 見た目の調整はこの4つ。触るとしたらここ。 */
  const NEAR   = 0.62;   /* 中央から隣までの距離（札の幅に対する割合） */
  const FAR    = 0.34;   /* 2つめから先の間隔（同上）。狭くすると奥で重なる */
  const TILT   = 48;     /* 中央以外の傾き（度） */
  const DEPTH  = 90;     /* 中央以外を奥へ下げる量（px） */
  const DRIFT  = 0.28;   /* 端に来たとき、群れ全体を中央へ寄せ戻す量（札の幅に対する割合） */

  const SLOW = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cur = 0;                 /* いま中央にある番号。指で動かしている間は小数になる */
  let dragging = false, moved = 0, startX = 0, startCur = 0, lastX = 0, lastDX = 0;

  stage.classList.add('on');
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('role', 'listbox');

  buildDots();
  layout(false);
  addEventListener('resize', () => layout(false));

  /* ---- 指・マウス ---- */
  stage.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    dragging = true; moved = 0; lastDX = 0;
    startX = lastX = e.clientX;
    startCur = cur;
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  });

  stage.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    lastDX = e.clientX - lastX;
    lastX  = e.clientX;
    moved  = Math.max(moved, Math.abs(dx));
    /* 指の動きに追いてまわす。端では引っぱっても少ししか動かないようにする */
    cur = clampSoft(startCur - dx / stepPx());
    layout(false);
    if (moved > 8) e.preventDefault();      /* 横に振っている間は縦スクロールを止める */
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    /* 勢いよく払ったときはひとつ先まで送る */
    const flick = Math.abs(lastDX) > 6 ? -Math.sign(lastDX) : 0;
    go(Math.round(cur) + flick);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);

  /* ---- 押したとき ---- */
  ring.addEventListener('click', e => {
    const a = e.target.closest('.hm-card');
    if (!a) return;
    if (moved > 8) { e.preventDefault(); moved = 0; return; }   /* 動かしただけ */
    const i = cards.indexOf(a);
    if (i !== Math.round(cur)) { e.preventDefault(); go(i); }   /* 中央でなければ、まず中央へ */
  });

  /* ---- ボタンとキーボード ---- */
  if (prevB) prevB.addEventListener('click', () => go(Math.round(cur) - 1));
  if (nextB) nextB.addEventListener('click', () => go(Math.round(cur) + 1));
  stage.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(Math.round(cur) - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.round(cur) + 1); }
  });
  /* Tab で送られてきた楽器は中央に出す（見えない札に focus が乗ったままにしない） */
  ring.addEventListener('focusin', e => {
    const a = e.target.closest('.hm-card');
    if (!a) return;
    const i = cards.indexOf(a);
    if (i !== Math.round(cur)) go(i);
  });

  /* ---- ここから下は組み立て ---- */

  function cardW() { return cards[0].offsetWidth || 150; }

  /* 隣へ送るのに要る指の移動量 */
  function stepPx() { return Math.max(60, cardW() * 0.62); }

  /* 端を越えたぶんは 1/4 しか動かさない（引っぱっている感じを出しつつ、行き過ぎない） */
  function clampSoft(v) {
    if (v < 0)     return v / 4;
    if (v > N - 1) return (N - 1) + (v - (N - 1)) / 4;
    return v;
  }

  function go(n) {
    cur = Math.max(0, Math.min(N - 1, n));
    layout(true);
  }

  function layout(animate) {
    const w = cardW();
    /* 一周しないので、端では札が片側に寄る（先頭なら右へ3枚）。
       そのままだと群れが画面の片側に寄って端で切れるため、全体を中央へ寄せ戻す。
       真ん中にいるときは 0 になるので、ふだんの見え方は変わらない。 */
    const shift = (cur - (N - 1) / 2) * w * DRIFT;
    cards.forEach((c, i) => {
      const o = i - cur;                       /* 中央からの隔たり（小数もあり） */
      const s = o < 0 ? -1 : 1;
      const a = Math.abs(o);

      /* 中央から1つめまでは NEAR、そこから先は FAR ずつ離す */
      const x  = s * w * (a < 1 ? NEAR * a : NEAR + (a - 1) * FAR) - shift;
      const z  = -(a < 1 ? DEPTH * a : DEPTH + (a - 1) * 40);
      const ry = -s * TILT * Math.min(a, 1);
      const sc = 1 - Math.min(a, 3) * 0.09;
      const op = 1 - Math.min(a, 3) * 0.20;

      c.style.transition = (animate && !SLOW)
        ? 'transform .38s cubic-bezier(.22,.61,.36,1), opacity .38s' : 'none';
      /* left:50% で左端を中央に置いてあるので、まず自分の幅の半分だけ左へ戻して中央に合わせる。
         これを CSS の margin でやると、画面幅によってずれて札が切れる。 */
      c.style.transform = 'translateX(-50%) '
                        + 'translateX(' + x.toFixed(1) + 'px) translateZ(' + z.toFixed(1) + 'px) '
                        + 'rotateY(' + ry.toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
      c.style.opacity = op.toFixed(2);
      c.style.zIndex  = String(Math.round(100 - a * 10));
      c.classList.toggle('front', Math.round(cur) === i);
      c.setAttribute('aria-selected', Math.round(cur) === i ? 'true' : 'false');
    });

    const f = Math.round(cur);
    if (dots) Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === f));
    if (prevB) prevB.disabled = (f <= 0);
    if (nextB) nextB.disabled = (f >= N - 1);
  }

  function buildDots() {
    if (!dots) return;
    dots.hidden = false;
    dots.innerHTML = '';
    cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hm-dot';
      /* 読み上げには楽器名を渡す（札の見出しをそのまま使う） */
      const name = c.querySelector('.b');
      b.setAttribute('aria-label', name ? name.childNodes[0].textContent.trim() : String(i + 1));
      b.addEventListener('click', () => go(i));
      dots.appendChild(b);
    });
  }
}
