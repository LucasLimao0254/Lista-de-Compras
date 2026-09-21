#!/usr/bin/env node
/*
 * Testes do service worker (service-worker.js): notificações de push e a regra de cache — sem dependências.
 *
 *   node tests/service-worker.test.mjs
 *
 * O arquivo é executado num contexto isolado (node:vm) com um `self` falso que só guarda os ouvintes de evento;
 * cada teste dispara o evento e confere o que o service worker pediu ao navegador.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'service-worker.js'), 'utf8');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok     ' + name); }
  catch (e) { fail++; console.log('  FALHA  ' + name + '\n         ' + String(e && e.message).split('\n')[0]); }
}

function boot({ clientsList = [] } = {}) {
  const handlers = {}, shown = [], opened = [], closed = [];
  const scope = 'https://app.example/Lista/';
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    location: new URL('https://app.example/Lista/service-worker.js'),
    skipWaiting: () => Promise.resolve(),
    registration: { scope, showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
    clients: { claim: () => Promise.resolve(), matchAll: async () => clientsList, openWindow: async url => { opened.push(String(url)); return {}; } },
  };
  const ctx = vm.createContext({ self, URL, Promise, JSON, fetch: async () => new Response('rede'), caches: { match: async () => undefined, open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], delete: async () => true }, Response });
  vm.runInContext(SRC, ctx);
  // dispara um evento com waitUntil/respondWith que registram a promessa
  const fire = async (type, extra = {}) => {
    let waited = null, responded = null, wasResponded = false;
    const e = Object.assign({ waitUntil: p => { waited = p; }, respondWith: p => { wasResponded = true; responded = p; } }, extra);
    handlers[type](e);
    if (waited) await waited;
    return { wasResponded, responded, waited };
  };
  return { fire, shown, opened, closed, handlers, ctx };
}
const pushEvent = data => ({ data: data === undefined ? null : { json: () => { if (typeof data === 'string') throw new SyntaxError('não é JSON'); return data; }, text: () => String(data) } });

console.log('\nService worker: push');
await test('push com título e corpo mostra a notificação, com ícone, marcador (tag) e destino', async () => {
  const sw = boot();
  await sw.fire('push', pushEvent({ title: '3 contas perto de vencer', body: 'Aluguel — hoje · R$ 1.200,00', tag: 'cf-vencimentos-2026-09-15' }));
  assert.equal(sw.shown.length, 1);
  const { title, opts } = sw.shown[0];
  assert.equal(title, '3 contas perto de vencer'); assert.equal(opts.body, 'Aluguel — hoje · R$ 1.200,00'); assert.equal(opts.tag, 'cf-vencimentos-2026-09-15');
  assert.match(opts.icon, /icon-192\.png$/); assert.equal(opts.data.view, 'despesas');
});
await test('push sem conteúdo ou com texto que não é JSON AINDA mostra uma notificação (iOS/Chrome punem push silencioso)', async () => {
  for (const ev of [pushEvent(undefined), pushEvent('texto solto'), pushEvent({}), pushEvent({ title: '', body: '' })]) {
    const sw = boot(); await sw.fire('push', ev);
    assert.equal(sw.shown.length, 1); assert.ok(sw.shown[0].title.length > 0, 'título padrão');
  }
});
await test('conteúdo do push é tratado como TEXTO: título/corpo gigantes são cortados e tipos estranhos não quebram', async () => {
  const sw = boot();
  await sw.fire('push', pushEvent({ title: 'x'.repeat(5000), body: { a: 1 }, tag: 123, data: { view: '<script>' } }));
  assert.equal(sw.shown.length, 1); assert.ok(sw.shown[0].title.length <= 120);
  assert.equal(typeof sw.shown[0].opts.body, 'string'); assert.equal(sw.shown[0].opts.data.view, 'despesas', 'o destino nunca vem do push');
});

console.log('\nService worker: clique na notificação');
await test('com o app aberto: foca a janela e pede para abrir Despesas', async () => {
  const calls = []; const client = { url: 'https://app.example/Lista/', focus: async () => { calls.push('focus'); return client; }, postMessage: m => calls.push(m) };
  const sw = boot({ clientsList: [client] }); let closed = false;
  await sw.fire('notificationclick', { notification: { close: () => { closed = true; }, data: { view: 'despesas' } } });
  assert.ok(closed); // JSON: o objeto nasce em outro contexto (vm), então deepEqual estrito falharia por causa do protótipo
  assert.equal(JSON.stringify(calls), JSON.stringify(['focus', { cfOpenView: 'despesas' }])); assert.deepEqual(sw.opened, []);
});
await test('com o app fechado: abre o app já em Despesas', async () => {
  const sw = boot(); await sw.fire('notificationclick', { notification: { close() {}, data: { view: 'despesas' } } });
  assert.deepEqual(sw.opened, ['https://app.example/Lista/#despesas']);
});
await test('clique numa notificação sem dados abre o app na tela inicial de Despesas do mesmo jeito (sem quebrar)', async () => {
  const sw = boot(); await sw.fire('notificationclick', { notification: { close() {} } });
  assert.deepEqual(sw.opened, ['https://app.example/Lista/#despesas']);
});

console.log('\nService worker: cache');
await test('só GET do próprio site passa pelo cache; POST e pedidos a outros sites (ex.: o Worker de avisos) não são interceptados', async () => {
  const sw = boot();
  const same = await sw.fire('fetch', { request: { method: 'GET', url: 'https://app.example/Lista/index.html' } }); assert.equal(same.wasResponded, true);
  const post = await sw.fire('fetch', { request: { method: 'POST', url: 'https://app.example/Lista/x' } }); assert.equal(post.wasResponded, false);
  const cross = await sw.fire('fetch', { request: { method: 'GET', url: 'https://avisos.exemplo.workers.dev/vapid' } }); assert.equal(cross.wasResponded, false);
});
await test('a versão do cache foi incrementada (o app novo precisa substituir a cópia antiga)', async () => {
  const m = /CACHE_NAME = 'controle-financeiro-v(\d+)'/.exec(SRC); assert.ok(m && Number(m[1]) >= 3, 'versão atual: ' + (m && m[1]));
});

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
