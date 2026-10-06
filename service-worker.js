// Service worker do Controle Financeiro.
// O app é um único arquivo HTML autocontido (a biblioteca de leitura de PDF já
// vem embutida nele) — então cachear esse arquivo cobre praticamente tudo que
// o app precisa pra funcionar offline. Estratégia "cache first, com atualização
// em segundo plano": abre rápido usando a cópia salva, e atualiza o cache pra
// próxima vez sempre que houver conexão.

const CACHE_NAME = 'controle-financeiro-v3';
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
  // Só o próprio site passa pelo cache: pedidos a outros endereços (ex.: a consulta da NFC-e) vão direto para a rede.
  if (new URL(event.request.url).origin !== self.location.origin) return;

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
        // Sem rede: a página do app só substitui uma NAVEGAÇÃO. Para qualquer outro pedido o erro tem de aparecer
        // (devolver o index.html fazia um pedido que falhou parecer bem-sucedido).
        .catch(() => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));

      // Serve do cache na hora se existir (rápido, funciona offline);
      // a rede atualiza o cache em segundo plano pra próxima visita.
      return cached || network;
    })
  );
});
