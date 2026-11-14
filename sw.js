// Wayfinder service worker: app shell works offline; map tiles you have viewed are cached; the downloaded Davidson County pack is served from the offline cache.
const V = 'wayfinder-414991ba', TILES = 'wayfinder-tiles', OFFLINE = 'wayfinder-offline', MAX_TILES = 600;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'traffic.sample.json',
  'style.css', 'quiet.js', 'quiet-words.json', 'app.js', 'datalayers.js', 'nav3d.js', 'people.js', 'vault.js', 'pwa.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/phosphor/icons.js', 'vendor/protomaps-leaflet/protomaps-leaflet.js', 'explore.html', 'explore.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES && k !== OFFLINE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
let packBlob = null;
self.addEventListener('message', e => { if (e.data === 'pack-changed') packBlob = null; });
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET') return;
  if (u.hostname === 'tile.openstreetmap.org') return e.respondWith(tile(req));
  if (u.origin !== location.origin) return;
  if (u.pathname.includes('/wayfinder-relay/')) return;                       // live bus data: never serve a stale copy
  if (u.pathname.endsWith('/data/davidson.pmtiles')) return e.respondWith(servePack(req));
  // network first so updates arrive; fall back to the cached copy when offline
  e.respondWith(fetch(req).then(r => { if (r.ok && r.status === 200) { const c = r.clone(); caches.open(V).then(ch => ch.put(req, c)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(h => h || caches.match('index.html'))));
});
// The pack is one big file read with HTTP Range requests (PMTiles). Once downloaded it lives in Cache Storage; answer ranges from it.
async function servePack(req) {
  if (!packBlob) { const hit = await (await caches.open(OFFLINE)).match(req.url); if (hit) packBlob = await hit.blob(); }
  if (!packBlob) return fetch(req);
  const b = packBlob, m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  const h = { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'x-wayfinder-source': 'offline-pack' };
  if (!m) return new Response(b, { status: 200, headers: { ...h, 'content-length': String(b.size) } });
  const s = +m[1], en = m[2] ? Math.min(+m[2], b.size - 1) : b.size - 1;
  return new Response(b.slice(s, en + 1), { status: 206, headers: { ...h, 'content-range': `bytes ${s}-${en}/${b.size}`, 'content-length': String(en - s + 1) } });
}
async function tile(req) {
  const c = await caches.open(TILES), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok) { c.put(req, r.clone()); trim(c); } return r; }).catch(() => hit);
  return hit || net;
}
async function trim(c) { const ks = await c.keys(); if (ks.length > MAX_TILES) await Promise.all(ks.slice(0, ks.length - MAX_TILES).map(k => c.delete(k))); }
