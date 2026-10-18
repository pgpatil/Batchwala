// Offline cache. Bump VERSION on every release so phones pick up the update.
const VERSION = "v2.10.0";
const CACHE = "batchwala-" + VERSION;
const SHELL = ["./", "index.html", "manifest.webmanifest", "css/app.css", "js/app.js", "js/core.js", "js/events.js", "js/sync.js", "js/storage/drive.js",
  "js/roles.js", "js/model.js", "js/orders.js", "js/money.js", "js/inventory.js", "js/batches.js", "js/pos.js", "js/bom.js", "js/plan.js", "js/table.js", "js/purchase.js", "js/wo.js", "js/reports.js", "js/lock.js", "js/erp.js", "js/help.js", "js/data.js", "js/match.js", "js/ocr.js", "js/ops.js", "js/admin.js", "js/waparse.js", "js/util.js", "js/ui.js", "js/config.js",
  "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))));
self.addEventListener("message", e => { if (e.data === "skip") self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("batchwala-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (/googleapis\.com$|accounts\.google\.com$|google\.com$/.test(u.hostname)) return;   // never cache Google sign-in or Drive
  if (u.origin === location.origin) { e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request))); return; }
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
