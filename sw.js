const CACHE_NAME = "pulse-habit-cache-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./activity.html",
  "./profile.html",
  "./styles.css",
  "./app.js",
  "./app-config.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then(function (response) {
          if (!response || response.status !== 200) {
            return response;
          }

          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseClone);
          });

          return response;
        })
        .catch(function () {
          return caches.match("./index.html");
        });
    })
  );
});

self.addEventListener("push", function (event) {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || "Pulse Habit";
  const options = {
    body: payload.body || "Tijd om je habit streak levend te houden.",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: payload.tag || "habit-reminder",
    data: {
      url: payload.url || "./index.html",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./index.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return Promise.resolve();
    })
  );
});
