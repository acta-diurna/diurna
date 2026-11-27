// Diurna の Service Worker
// - 画面のファイル（同じ場所のもの）：つながるときは新しいものを取り、つながらないときは前回のものを出す
// - プッシュ通知：届くのは中身のない合図だけ。合言葉で GAS の getPushInbox から中身を取って表示する
//   （合言葉・窓口・端末の番号は、画面が caches の diurna-cfg に入れておく）
const CACHE = 'diurna-v5';
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
    let items = [], cfg = null, why = '';
    try { const res = await (await caches.open(CFG)).match('cfg'); cfg = res ? await res.json() : null; } catch (err) { why = 'cfg ' + err; }
    // 2026/11/27：サーバーは中身を返したのに、iPhone が返事を受け取れず「新しいお知らせがあります」になった（夜のまとめ）。
    // GAS の返事は別のアドレスへ転送されて届くので、その途中で失敗することがある → 3回まで取り直す（サーバーは15分以内の最新1件を返す）。
    // 失敗したわけは、次に取りに行くときにサーバーへ伝える（errlog に残る）
    if (cfg && cfg.k) {
      let prev = '';
      try { const p = await (await caches.open(CFG)).match('err'); prev = p ? await p.text() : ''; } catch (err) { }
      for (let i = 0; i < 3 && !items.length; i++) {
        if (i) await new Promise(r => setTimeout(r, 1500));
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const tm = ac ? setTimeout(() => ac.abort(), 12000) : 0;
        try {
          const r = await fetch(cfg.api, { method: 'POST', signal: ac ? ac.signal : undefined,
            body: JSON.stringify({ k: cfg.k, fn: 'getPushInbox', args: [cfg.id || '', (prev ? prev + ' / ' : '') + (why ? '失敗' + i + '回 ' + why : '')] }) }).then(r => r.json());
          if (r.error) { why = String(r.error); break; }
          items = Array.isArray(r.result) ? r.result : [];
          prev = ''; if (!items.length) break;
        } catch (err) { why = String(err && err.name || err).slice(0, 80); }
        clearTimeout(tm);
      }
      try { const c = await caches.open(CFG); if (items.length) await c.delete('err'); else if (why) await c.put('err', new Response(new Date().toISOString().slice(5, 16) + ' ' + why)); } catch (err) { }
    }
    // iPhone は合図を受けたら必ず通知を出す決まりなので、中身を取れなくても1つ出す
    if (!items.length) items = [{ id: 'diurna', title: 'Diurna', body: '新しいお知らせがあります（押すと Diurna が開きます）', url: './' }];
    await Promise.all(items.slice(-3).map(it => self.registration.showNotification(it.title || 'Diurna', {
      body: it.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: it.id || 'diurna', data: { url: it.url || './' },
    })));
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  // url の #go=… が開くページ。開いている画面があれば前に出して行き先を伝え、なければその url で開く
  const url = (e.notification.data && e.notification.data.url) || './';
  const m = /[#&]go=([^&]+)/.exec(url);
  const go = m ? decodeURIComponent(m[1]) : '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus().then(c => { if (go) (c || w).postMessage({ go }); });
    return self.clients.openWindow(url);
  }));
});
