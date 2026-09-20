// Service worker do Controle Financeiro.
// O app é um único arquivo HTML autocontido (a biblioteca de leitura de PDF já
// vem embutida nele) — então cachear esse arquivo cobre praticamente tudo que
// o app precisa pra funcionar offline. Estratégia "cache first, com atualização
// em segundo plano": abre rápido usando a cópia salva, e atualiza o cache pra
// próxima vez sempre que houver conexão.

const CACHE_NAME = 'controle-financeiro-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));

      // Serve do cache na hora se existir (rápido, funciona offline);
      // a rede atualiza o cache em segundo plano pra próxima visita.
      return cached || network;
    })
  );
});
