/*
  home-gallery.js — 言語別トップ（/{言語}/）の楽器選択。

  回転台（ターンテーブル）に楽器を等間隔で載せて回す。4種なら 12時・3時・6時・9時。
  ・12時（手前）がいま選んでいる楽器
  ・3時・9時は左右に、内側を向いて傾いた状態で見える
  ・6時は 12時の真後ろ。いちばん奥なのでぼかして薄くする
  横へ滑らせるのではなく円周に沿って回り込むので、動きが回転として読める。
  奥ほど「小さく・薄く・ぼける」ようにして遠近を出している。

  ・指で左右に払う（マウスならドラッグ）と、指に追いてまわり、離すと近い位置で止まる。
  ・中央の楽器を押すとその楽器のページへ。中央でないものを押したときは、
    進まずにその楽器を中央へ持ってくる（押し間違いを進行にしないため）。
  ・‹ › のボタン、下の丸、キーボードの ← → でも動く。
  ・一周する。端で止まらないので、同じ向きに回し続けられる。
    いま何番目かは下の丸で分かる。

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
  const STEP   = 360 / N; /* 楽器1つあたりの回転角。4つなら 90 度 ＝ 12時・3時・6時・9時 */
  const RAD    = 0.95;    /* 回転の半径（札の幅に対する割合）。大きいほど奥行きが出る */
  const FACE   = 0.45;    /* 札の向き。1 なら円筒どおり真横（＝見えない）まで向く。
                             0.45 だと 3時・9時で 40 度ほどの傾きになり、正面が見える */
  const BLUR   = 4.0;     /* いちばん奥（6時）でのぼかし量（px） */

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
    /* ここでは まだ setPointerCapture しない。
       捕まえたままにすると、そのあとの click が <a> ではなく捕まえた側へ飛ぶ browser があり、
       PC でカードを押してもページへ進めなくなる。実際に動かし始めてから捕まえる。 */
  });

  stage.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    lastDX = e.clientX - lastX;
    lastX  = e.clientX;
    const wasDrag = moved > 8;
    moved  = Math.max(moved, Math.abs(dx));
    /* 8px を越えて はじめて「回している」とみなし、そこで初めて捕まえる。
       ただ押しただけのときは捕まえないので、click がそのまま <a> に届く（PCのクリック対策）。 */
    if (!wasDrag && moved > 8) { try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
    /* 指の動きに追いてまわす */
    cur = startCur - dx / stepPx();      /* 一周するので、どこまで回しても止めない */
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
    if (i !== front()) { e.preventDefault(); go(nearest(i)); }  /* 中央でなければ、まず中央へ */
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
    if (i !== front()) go(nearest(i));
  });

  /* ---- ここから下は組み立て ---- */

  function cardW() { return cards[0].offsetWidth || 150; }

  /* 隣へ送るのに要る指の移動量 */
  function stepPx() { return Math.max(60, cardW() * 0.62); }

  /* いま中央にある番号（0〜N-1）。
     cur は一周しても止めず増減し続けるので、割った余りで見る（-1 も N-1 として扱う）。 */
  function front() { return ((Math.round(cur) % N) + N) % N; }

  /* i 番を中央に持ってくるための cur。遠回りしないよう、近いほうへ回す。 */
  function nearest(i) {
    let d = (i - front()) % N;
    if (d >  N / 2) d -= N;
    if (d < -N / 2) d += N;
    return Math.round(cur) + d;
  }

  function go(n) {
    cur = n;                 /* 端で止めない＝一周してそのまま先へ回り続ける */
    layout(true);
  }

  function layout(animate) {
    const w = cardW();
    const R = w * RAD;
    cards.forEach((c, i) => {
      const o = i - cur;                       /* 中央からの隔たり（小数もあり） */

      /* 回転台に等間隔で載せる。4つなら 12時・3時・6時・9時。
         角度は -180〜180 に畳んでから使う（9時は +270 度ではなく -90 度として扱う）。
           x … 円周を横から見たときの左右の位置（半径 × sin）
           z … 同じく奥行き（半径 × cos。手前の1つを 0 に合わせるため半径を引く）
         向きは角度そのままだと 3時・9時で真横になって見えなくなるので、FACE で控えめにする。 */
      let ph = o * STEP;
      ph = ((ph + 180) % 360 + 360) % 360 - 180;
      const rd = ph * Math.PI / 180;
      const x  = R * Math.sin(rd);
      const z  = R * (Math.cos(rd) - 1);
      const ry = ph * FACE;

      /* 濃さ・ぼかし・大きさは「どれだけ奥にあるか」だけで決める。
         0 ＝ 手前（12時）、0.5 ＝ 横（3時・9時）、1 ＝ いちばん奥（6時）。
         左右を同じ扱いにできるので、3時と9時がそろって見える。 */
      const d  = -z / (2 * R);
      const sc = 1 - d * 0.12;
      const op = 1 - d * 0.80;
      const bl = d * BLUR;

      c.style.transition = (animate && !SLOW)
        ? 'transform .42s cubic-bezier(.22,.61,.36,1), opacity .42s, filter .42s' : 'none';
      c.style.filter = bl > 0.05 ? 'blur(' + bl.toFixed(2) + 'px)' : 'none';
      /* left:50% で左端を中央に置いてあるので、まず自分の幅の半分だけ左へ戻して中央に合わせる。
         これを CSS の margin でやると、画面幅によってずれて札が切れる。 */
      c.style.transform = 'translateX(-50%) '
                        + 'translateX(' + x.toFixed(1) + 'px) translateZ(' + z.toFixed(1) + 'px) '
                        + 'rotateY(' + ry.toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
      c.style.opacity = op.toFixed(2);
      c.style.zIndex  = String(Math.round(100 - d * 50));
      c.classList.toggle('front', front() === i);
      c.setAttribute('aria-selected', front() === i ? 'true' : 'false');
    });

    const f = front();
    if (dots) Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === f));
    /* 一周するので ‹ › は常に押せる（端という概念が無い） */
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
      b.addEventListener('click', () => go(nearest(i)));
      dots.appendChild(b);
    });
  }
}
