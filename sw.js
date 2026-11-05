// Diurna の Service Worker
// - 画面のファイル（同じ場所のもの）：つながるときは新しいものを取り、つながらないときは前回のものを出す
// - プッシュ通知：届くのは中身のない合図だけ。合言葉で GAS の getPushInbox から中身を取って表示する
//   （合言葉・窓口・端末の番号は、画面が caches の diurna-cfg に入れておく）
const CACHE = 'diurna-v3';
const CFG = 'diurna-cfg';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'manifest.webmanifest', 'icon-192.png'])));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CFG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // ブラウザの一時保存（10分）を使わず、毎回新しいものを確かめる
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const res = await (await caches.open(CFG)).match('cfg');
      const cfg = res ? await res.json() : null;
      if (cfg && cfg.k) {
        const r = await fetch(cfg.api, { method: 'POST', body: JSON.stringify({ k: cfg.k, fn: 'getPushInbox', args: [cfg.id || ''] }) }).then(r => r.json());
        items = Array.isArray(r.result) ? r.result : [];
      }
    } catch (err) { }
    // iPhone は合図を受けたら必ず通知を出す決まりなので、中身を取れなくても1つ出す
    if (!items.length) items = [{ id: 'diurna', title: 'Diurna', body: '新しいお知らせがあります', url: './' }];
    await Promise.all(items.slice(-3).map(it => self.registration.showNotification(it.title || 'Diurna', {
      body: it.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: it.id || 'diurna', data: { url: it.url || './' },
    })));
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
