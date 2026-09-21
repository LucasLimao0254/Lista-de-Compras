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
  // Só o próprio site passa pelo cache. Pedidos a outros endereços (o Worker de avisos) vão direto para a rede:
  // cachear a chave VAPID, por exemplo, deixaria uma cópia velha valendo para sempre.
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
        .catch(() => cached || caches.match('./index.html'));

      // Serve do cache na hora se existir (rápido, funciona offline);
      // a rede atualiza o cache em segundo plano pra próxima visita.
      return cached || network;
    })
  );
});

// ---- Avisos por push (o Worker em push-worker/ envia; ver HANDOFF.md) ----
// Todo push PRECISA virar uma notificação visível (iOS e Chrome revogam a permissão de quem recebe push silencioso),
// então qualquer problema no conteúdo cai num texto padrão em vez de não mostrar nada. O conteúdo é sempre texto puro.
const text = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

self.addEventListener('push', (event) => {
  let d = null;
  try { d = event.data ? event.data.json() : null; } catch (e) { d = null; }
  if (!d || typeof d !== 'object') d = {};
  const title = text(d.title, 100) || 'Controle Financeiro';
  const body = text(d.body, 400) || 'Você tem contas perto de vencer.';
  event.waitUntil(self.registration.showNotification(title, {
    body: body,
    tag: text(d.tag, 80) || 'cf-vencimentos',   // mesmo tag = substitui a notificação anterior em vez de empilhar
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { view: 'despesas' },                  // o destino nunca vem do push
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length) {
        const client = list[0];
        return client.focus().then(() => client.postMessage({ cfOpenView: 'despesas' }));
      }
      return self.clients.openWindow(new URL('./#despesas', self.registration.scope).href);
    })
  );
});
