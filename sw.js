/* aws.manual — cache-first service worker, so an http-served copy also works
   with the network unplugged. Bump CACHE when the payload changes. */

var CACHE = "aws-manual-v1";
var ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/css/terminal.css",
  "assets/js/app.js",
  "assets/js/shell.js",
  "assets/js/boot.js",
  "assets/favicon.svg",
  "data/content.js",
  "figures/aws-market-landscape.png",
  "figures/aws-data-transfer-costs.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        return response;
      }).catch(function () {
        return caches.match("index.html");
      });
    })
  );
});
