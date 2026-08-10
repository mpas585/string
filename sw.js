/*
  sw.js — Service Worker（ホーム画面に保存したときのアプリ挙動）。

  方針:
    ・HTML（PHP が返すページ）は【ネットワーク優先】。落ちたらキャッシュ、それも無ければ簡易オフライン表示。
      → 言語切替・ログイン状態など、サーバの出力が変わるものを古い内容で見せない。
    ・src/ と public/ の静的ファイルは【stale-while-revalidate】。
      → 表示は即座（キャッシュ）、裏で取り直して次回に反映＝アプリらしい起動速度。
    ・api/ は一切キャッシュしない。
    ・CDN（jszip / pdf.js）はURLにバージョンが入っているのでキャッシュ優先。

  更新するとき: 下の VER を上げる。古いキャッシュは activate で消える。
  ルート直下に置くこと（スコープが / になる）。
*/
const VER   = 'gs-v23';
const CORE  = 'core-' + VER;    /* 先読みする最小限 */
const ASSET = 'asset-' + VER;   /* src/ public/ の実行時キャッシュ */
const PAGE  = 'page-' + VER;    /* HTML の控え */

/* インストール時に取っておくもの。ここに増やしすぎると更新のたびに重くなる */
const PRECACHE = [
  'src/styles.css',
  'src/main.js',
  'public/icons/icon-192-v2.png',
  'public/icons/apple-touch-icon-v2.png',
];

const scopePath = new URL(self.registration.scope).pathname;   /* 例: '/' */

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CORE);
    /* 1つでも失敗すると addAll ごと落ちるので、個別に入れて失敗は無視する */
    await Promise.all(PRECACHE.map(p => c.add(new Request(scopePath + p, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keep = [CORE, ASSET, PAGE];
    const names = await caches.keys();
    await Promise.all(names.map(n => keep.includes(n) ? null : caches.delete(n)));
    await self.clients.claim();
  })());
});

/* ページからの合図で即時更新できるようにしておく（src/pwa.js が使う） */
self.addEventListener('message', (ev) => {
  if (ev.data === 'skipWaiting') self.skipWaiting();
});

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>offline</title><body style="margin:0;display:flex;align-items:center;justify-content:center;' +
  'height:100vh;background:#15110c;color:#bdb8b1;font-family:system-ui,sans-serif;text-align:center">' +
  '<div><div style="font-size:34px;margin-bottom:10px">🎻</div>' +
  '<div style="font-size:13px">オフラインです / You are offline</div></div></body>';

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = (url.origin === self.location.origin);

  /* 送信系はキャッシュに触れない。/oauth/ は Google への転送なので同じ扱いにする */
  if (sameOrigin && (url.pathname.includes('/api/') || url.pathname.includes('/oauth/'))) return;

  /* HTML: ネットワーク優先 */
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    ev.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) { const c = await caches.open(PAGE); c.put(req, res.clone()); }
        return res;
      } catch (e) {
        const hit = await caches.match(req, { ignoreSearch: true });
        return hit || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
      }
    })());
    return;
  }

  /* CDN: キャッシュ優先（URLにバージョンが入っているので古くならない） */
  if (!sameOrigin) {
    ev.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(ASSET); c.put(req, res.clone()); }
        return res;
      } catch (e) { return hit || Response.error(); }
    })());
    return;
  }

  /* 自サイトの静的ファイル: stale-while-revalidate */
  ev.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(res => {
      if (res && res.ok) { caches.open(ASSET).then(c => c.put(req, res.clone())); }
      return res;
    }).catch(() => null);
    return hit || (await net) || new Response('', { status: 504 });
  })());
});
