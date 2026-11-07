const CACHE = 'shelem-v3';
const ASSETS = ['./','./index.html','./style.css','./theme.css','./script.js','./lock.js','./manifest.webmanifest','./icon.svg',
  './lib/chart.js','./lib/chartjs-plugin-annotation.min.js','./lib/jalali-moment.browser.js','./fonts/fonts.css',
  './fonts/Dxxo8j6PP2D_kU2muijlE8WWIGroe7ll.woff2','./fonts/Dxxo8j6PP2D_kU2muijlGMWWIGroe7ll.woff2','./fonts/Dxxo8j6PP2D_kU2muijlHcWWIGroew.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, {ignoreSearch:true}).then(r => r || fetch(e.request)));
});
