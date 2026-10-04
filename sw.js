// Offline cache: everything the app needs (including the OCR engine + English model) is stored on install.
// Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'wt-v10';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.json',
  'metrics.js', 'parser.js', 'store.js', 'excel.js', 'ocr.js', 'charts.js', 'app.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/chart.umd.min.js', 'vendor/xlsx.full.min.js',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-lstm.wasm.js', 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/lang/eng.traineddata.gz',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/data/seed.json')) return; // never cache personal seed data
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
