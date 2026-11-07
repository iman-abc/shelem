const CACHE = 'shelem-v9';
const ASSETS = ['./','./index.html','./style.css','./theme.css','./script.js','./config.js','./auth.js','./install.js','./icon-192.png','./icon-512.png','./icon-180.png','./manifest.webmanifest','./icon.svg',
  './lib/chart.js','./lib/chartjs-plugin-annotation.min.js','./lib/jalali-moment.browser.js','./fonts/fonts.css',
  './fonts/Dxxo8j6PP2D_kU2muijlE8WWIGroe7ll.woff2','./fonts/Dxxo8j6PP2D_kU2muijlGMWWIGroe7ll.woff2','./fonts/Dxxo8j6PP2D_kU2muijlHcWWIGroew.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
// Network-first for our own files (always fresh when online), cache fallback when offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
