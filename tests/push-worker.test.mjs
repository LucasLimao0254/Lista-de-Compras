#!/usr/bin/env node
/*
 * Testes do Worker de avisos por push (push-worker/worker.mjs) — sem dependências, só Node >= 22.
 *
 *   node tests/push-worker.test.mjs
 *
 * O Worker roda aqui com um KV em memória e um "serviço de push" falso (fetch substituído). A criptografia
 * (RFC 8291) e a assinatura VAPID (RFC 8292) são conferidas por implementações INDEPENDENTES escritas no teste
 * com o módulo `crypto` do Node — nada do próprio Worker é reaproveitado para decifrar/verificar.
 */
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import worker, { encryptPayload, handleRequest, runCron, dueBills } from '../push-worker/worker.mjs';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok     ' + name); }
  catch (e) { fail++; console.log('  FALHA  ' + name + '\n         ' + String(e && e.message).split('\n')[0]); }
}
const group = t => console.log('\n' + t);
const b64u = buf => Buffer.from(buf).toString('base64url');
const norm = s => String(s).replace(/\s+/g, ' ').trim();   // NBSP do "R$ 1.200,00" vira espaço comum

/* ------------------------------------------------------------------ apoio */
function makeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { if (!m.has(k)) return null; const v = m.get(k).value; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v, opts) { m.set(k, { value: v, opts }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', cursor } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
  };
}
function vapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { pub: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])), priv: jwk.d };
}
const VK = vapidKeys();
const ORIGIN = 'https://app.example';
function makeEnv(extra = {}) {
  return { SUBS: makeKV(), VAPID_PUBLIC_KEY: VK.pub, VAPID_PRIVATE_KEY: VK.priv, VAPID_SUBJECT: 'mailto:teste@example.com', ALLOWED_ORIGINS: ORIGIN, ...extra };
}
let subCounter = 0;
function newSub(endpoint) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  endpoint = endpoint || 'https://fcm.googleapis.com/fcm/send/dispositivo-' + (++subCounter);
  return { ecdh, auth, sub: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}
const call = (env, method, path, body, { origin = ORIGIN, now } = {}) => handleRequest(new Request('https://avisos.example' + path, {
  method, headers: Object.assign({ 'Content-Type': 'application/json' }, origin ? { Origin: origin } : {}),
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
}), env, now);

// "serviço de push" falso: guarda cada envio e responde conforme o endpoint
const realFetch = globalThis.fetch;
let sent = [];
let respond = url => 201;
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), headers: init.headers, body: Buffer.from(init.body) }); const st = respond(String(url)); return new Response(null, { status: st }); };
const reset = () => { sent = []; respond = () => 201; };

// Decifragem independente (RFC 8291 §4/§5), pelo lado do navegador
function decrypt(body, ecdh, auth) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const secret = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let i = plain.length - 1; while (i >= 0 && plain[i] === 0) i--;
  assert.equal(plain[i], 2, 'delimitador de último registro');
  return plain.subarray(0, i).toString('utf8');
}
const payloadOf = (s, dev) => JSON.parse(decrypt(s.body, dev.ecdh, dev.auth));

// Confere o cabeçalho VAPID (RFC 8292) com verificação real da assinatura ES256
function checkVapid(headers, endpoint, atMs = Date.now()) {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(headers.Authorization);
  assert.ok(m, 'formato "vapid t=…, k=…": ' + headers.Authorization);
  const [, h, c, sig, k] = m;
  assert.equal(k, VK.pub);
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin); assert.equal(claims.sub, 'mailto:teste@example.com');
  const nowS = atMs / 1000; assert.ok(claims.exp > nowS && claims.exp - nowS <= 24 * 3600, 'exp entre agora e 24h');
  const pub = Buffer.from(k, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'assinatura ES256 inválida');
}

const SP = 'America/Sao_Paulo';
const AT = iso => Date.parse(iso);
const D15_0805 = AT('2026-09-15T11:05:00Z');   // 15/09/2026 08:05 em São Paulo
const BILLS = [
  { name: 'Aluguel', amount: 1200, dueDay: 15, paid: false },
  { name: 'Internet', amount: 119.9, dueDay: 16, paid: false },
  { name: 'Água', amount: 95, dueDay: 18, paid: false },
  { name: 'Luz', amount: 240, dueDay: 19, paid: false },                       // 4 dias: fora da janela de 3
  { name: 'Condomínio', amount: 350, dueDay: 15, paid: true },                 // já paga
  { name: 'Cartão', amount: 800, dueDay: 16, paid: false, unpaidMonths: 2 },   // já está atrasada há meses
];
const subBody = (dev, extra = {}) => Object.assign({ subscription: dev.sub, bills: BILLS, cycle: '2026-09', tz: SP, hour: 8, leadDays: 3 }, extra);
async function register(env, dev, extra, now = D15_0805 - 3 * 3600e3) { const r = await call(env, 'POST', '/subscribe', subBody(dev, extra), { now }); assert.equal(r.status, 200, await r.clone().text()); return r; }
const records = env => [...env.SUBS.m.entries()].map(([k, v]) => ({ k, ...JSON.parse(v.value) }));

/* ================================================================== criptografia e VAPID */
group('Criptografia do payload (RFC 8291) e VAPID (RFC 8292)');
await test('vetor de teste do Apêndice A da RFC 8291 gera exatamente a mensagem da RFC', async () => {
  const bytes = s => Buffer.from(s, 'base64url');
  const asPub = bytes('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64u(asPub.subarray(1, 33)), y: b64u(asPub.subarray(33, 65)), ext: true };
  const out = await encryptPayload(
    { endpoint: 'https://x', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
    'When I grow up, I want to be a watermelon', { ephemeralJwk: jwk, salt: bytes('DGv6ra1nlYgDCS1FRnbzlw') });
  assert.equal(b64u(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});
await test('mensagem cifrada com chaves aleatórias é decifrada por uma implementação independente (acentos e emoji)', async () => {
  const dev = newSub(); const text = JSON.stringify({ title: 'Água — vence amanhã ✓', body: 'Condomínio · R$ 350,00' });
  const out = Buffer.from(await encryptPayload(dev.sub, text));
  assert.equal(decrypt(out, dev.ecdh, dev.auth), text);
  const outra = Buffer.from(await encryptPayload(dev.sub, text));
  assert.notEqual(b64u(out), b64u(outra), 'sal e chave efêmera devem mudar a cada envio');
});
await test('o envio usa cabeçalhos corretos e uma assinatura VAPID que confere', async () => {
  reset(); const env = makeEnv(), dev = newSub();
  await register(env, dev);
  const r = await call(env, 'POST', '/test', { subscription: dev.sub });
  assert.equal(r.status, 200); assert.equal(sent.length, 1);
  const s = sent[0]; assert.equal(s.url, dev.sub.endpoint);
  assert.equal(s.headers['Content-Encoding'], 'aes128gcm'); assert.match(s.headers.TTL, /^\d+$/);
  checkVapid(s.headers, dev.sub.endpoint);
});

/* ================================================================== segurança da API */
group('Segurança: origem (CORS), endereços de push permitidos e limites');
await test('só a origem do app é aceita; sem Origin ou de outro site: 403, sem cabeçalhos CORS', async () => {
  const env = makeEnv(), dev = newSub();
  for (const origin of [null, 'https://evil.example', 'https://app.example.evil.com']) {
    const r = await call(env, 'POST', '/subscribe', subBody(dev), { origin });
    assert.equal(r.status, 403, String(origin)); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(env.SUBS.m.size, 0);
});
await test('pré-voo (OPTIONS) da origem permitida responde 204 com os cabeçalhos certos', async () => {
  const r = await call(makeEnv(), 'OPTIONS', '/subscribe');
  assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(r.headers.get('Access-Control-Allow-Methods'), /POST/); assert.match(r.headers.get('Access-Control-Allow-Headers'), /Content-Type/i);
});
await test('GET /vapid devolve a chave pública (e só ela)', async () => {
  const r = await call(makeEnv(), 'GET', '/vapid');
  assert.equal(r.status, 200); const j = await r.json(); assert.deepEqual(j, { publicKey: VK.pub });
});
await test('endereço de push fora da lista dos serviços conhecidos é recusado (evita o Worker chamar qualquer site)', async () => {
  reset(); const env = makeEnv();
  for (const endpoint of ['https://evil.example/x', 'http://fcm.googleapis.com/fcm/send/a', 'https://fcm.googleapis.com.evil.com/a', 'https://user:pw@fcm.googleapis.com/a', 'https://fcm.googleapis.com:8443/a', 'https://169.254.169.254/latest', 'javascript:alert(1)', 'nao-e-url']) {
    const dev = newSub(endpoint);
    const r = await call(env, 'POST', '/subscribe', subBody(dev)); assert.equal(r.status, 400, endpoint);
    const t = await call(env, 'POST', '/test', { subscription: dev.sub }); assert.equal(t.status, 400, 'teste: ' + endpoint);
  }
  assert.equal(env.SUBS.m.size, 0); assert.equal(sent.length, 0);
});
await test('Chrome/Android, Firefox, Safari/iOS e Edge/Windows são aceitos', async () => {
  const env = makeEnv();
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QAbc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) {
    const r = await call(env, 'POST', '/subscribe', subBody(newSub(endpoint))); assert.equal(r.status, 200, endpoint);
  }
});
await test('dados inválidos são recusados com 400: chaves, contas, fuso, hora, antecedência e corpo enorme', async () => {
  const env = makeEnv(), dev = newSub();
  const ruins = [
    ['sem keys', { subscription: { endpoint: dev.sub.endpoint } }],
    ['p256dh curto', { subscription: { endpoint: dev.sub.endpoint, keys: { p256dh: 'abc', auth: dev.sub.keys.auth } } }],
    ['auth curto', { subscription: { endpoint: dev.sub.endpoint, keys: { p256dh: dev.sub.keys.p256dh, auth: 'abc' } } }],
    ['dia 0', { bills: [{ name: 'A', amount: 1, dueDay: 0, paid: false }] }], ['dia 32', { bills: [{ name: 'A', amount: 1, dueDay: 32, paid: false }] }],
    ['dia fracionário', { bills: [{ name: 'A', amount: 1, dueDay: 1.5, paid: false }] }], ['valor negativo', { bills: [{ name: 'A', amount: -1, dueDay: 5, paid: false }] }],
    ['valor texto', { bills: [{ name: 'A', amount: 'x', dueDay: 5, paid: false }] }], ['sem nome', { bills: [{ name: '', amount: 1, dueDay: 5, paid: false }] }],
    ['bills não é lista', { bills: 'oi' }], ['contas demais', { bills: Array.from({ length: 501 }, (_, i) => ({ name: 'C' + i, amount: 1, dueDay: 5, paid: false })) }],
    ['fuso inexistente', { tz: 'Marte/Olympus' }], ['hora 24', { hour: 24 }], ['hora fracionária', { hour: 8.5 }], ['antecedência 8', { leadDays: 8 }], ['antecedência -1', { leadDays: -1 }],
    ['ciclo inválido', { cycle: '09/2026' }],
  ];
  for (const [nome, extra] of ruins) { const r = await call(env, 'POST', '/subscribe', subBody(dev, extra)); assert.equal(r.status, 400, nome); }
  assert.equal((await call(env, 'POST', '/subscribe', '{isso não é json')).status, 400, 'JSON quebrado');
  assert.equal((await call(env, 'POST', '/subscribe', subBody(dev, { bills: [{ name: 'x'.repeat(80000), amount: 1, dueDay: 5, paid: false }] }))).status, 413, 'corpo grande');
  assert.equal(env.SUBS.m.size, 0);
});
await test('rotas desconhecidas: 404; método errado: 405', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'POST', '/naoexiste', {})).status, 404); assert.equal((await call(env, 'GET', '/subscribe')).status, 405);
});
await test('limite de assinaturas (uso pessoal): a 11ª é recusada com 429, mas quem já existe ainda atualiza', async () => {
  const env = makeEnv(), devs = Array.from({ length: 10 }, () => newSub());
  for (const d of devs) await register(env, d);
  assert.equal((await call(env, 'POST', '/subscribe', subBody(newSub()))).status, 429);
  assert.equal((await call(env, 'POST', '/subscribe', subBody(devs[3], { hour: 9 }))).status, 200);
  assert.equal(env.SUBS.m.size, 10);
});

/* ================================================================== assinatura e teste */
group('Assinar, atualizar, cancelar e enviar teste');
await test('assinar grava a lista de contas e o fuso; assinar de novo atualiza e preserva o "já avisado hoje"', async () => {
  reset(); const env = makeEnv(), dev = newSub();
  await register(env, dev, {}, AT('2026-09-15T10:00:00Z'));   // 07:00 em SP, antes das 8h → ainda pode avisar hoje
  let [r] = records(env); assert.equal(r.tz, SP); assert.equal(r.bills.length, 6); assert.equal(r.lastSent, null);
  await runCron(env, D15_0805); assert.equal(sent.length, 1); [r] = records(env); assert.equal(r.lastSent, '2026-09-15');
  // muda o horário para 20h e reenvia às 08:06: sem preservar o registro, o app "esqueceria" que já avisou hoje e o horário novo (20h) ainda não chegou
  await call(env, 'POST', '/subscribe', subBody(dev, { bills: [BILLS[0]], hour: 20 }), { now: D15_0805 + 60e3 });
  [r] = records(env); assert.equal(r.bills.length, 1); assert.equal(r.lastSent, '2026-09-15', 'não pode reenviar por causa de uma atualização');
  assert.ok(env.SUBS.m.values().next().value.opts.expirationTtl > 86400 * 30, 'a assinatura expira sozinha se o app nunca mais for aberto');
});
await test('quem ativa DEPOIS da hora de avisar não recebe um aviso de surpresa no mesmo dia', async () => {
  reset(); const env = makeEnv(), dev = newSub();
  await register(env, dev, {}, AT('2026-09-15T18:00:00Z'));   // 15h em SP, hora do aviso = 8h
  await runCron(env, AT('2026-09-15T19:05:00Z')); assert.equal(sent.length, 0);
  await runCron(env, AT('2026-09-16T11:05:00Z')); assert.equal(sent.length, 1, 'no dia seguinte já avisa');
});
await test('cancelar remove a assinatura (e cancelar uma que não existe não dá erro)', async () => {
  const env = makeEnv(), dev = newSub(); await register(env, dev);
  assert.equal((await call(env, 'POST', '/unsubscribe', { subscription: dev.sub })).status, 200); assert.equal(env.SUBS.m.size, 0);
  assert.equal((await call(env, 'POST', '/unsubscribe', { subscription: dev.sub })).status, 200);
});
await test('/test entrega uma notificação de teste decifrável', async () => {
  reset(); const env = makeEnv(), dev = newSub();
  const r = await call(env, 'POST', '/test', { subscription: dev.sub }); assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
  const p = payloadOf(sent[0], dev); assert.match(p.title, /teste/i); assert.ok(p.body.length > 10);
});
await test('/test: se o serviço de push recusa (403) ou a assinatura expirou (410), o motivo volta para a tela', async () => {
  reset(); const env = makeEnv(), dev = newSub(), gone = newSub('https://fcm.googleapis.com/fcm/send/gone');
  respond = () => 403; let r = await call(env, 'POST', '/test', { subscription: dev.sub }); let j = await r.json();
  assert.equal(r.status, 502); assert.equal(j.ok, false); assert.equal(j.status, 403);
  await register(env, gone); respond = () => 410; r = await call(env, 'POST', '/test', { subscription: gone.sub }); j = await r.json();
  assert.equal(j.ok, false); assert.equal(j.status, 410); assert.match(j.error, /expir/i); assert.equal(env.SUBS.m.size, 0, 'assinatura morta é apagada');
});

/* ================================================================== quais contas avisar */
group('Quais contas entram no aviso (dueBills)');
const P = (y, m, d) => ({ y, m, d, h: 8 });
const names = (bills, cycle, parts, lead = 3) => dueBills({ bills, cycle, leadDays: lead }, parts).map(x => x.name + ':' + x.diff);
await test('hoje, amanhã e até 3 dias; fora da janela, pagas e atrasadas há meses ficam de fora', async () => {
  assert.deepEqual(names(BILLS, '2026-09', P(2026, 9, 15)), ['Aluguel:0', 'Internet:1', 'Água:3']);
});
await test('antecedência configurável: 0 = só hoje; 7 pega a semana inteira', async () => {
  assert.deepEqual(names(BILLS, '2026-09', P(2026, 9, 15), 0), ['Aluguel:0']);
  assert.deepEqual(names(BILLS, '2026-09', P(2026, 9, 15), 7), ['Aluguel:0', 'Internet:1', 'Água:3', 'Luz:4']);
});
await test('conta que já venceu neste mês e não foi paga NÃO entra (já está atrasada)', async () => {
  assert.deepEqual(names([{ name: 'Gás', amount: 90, dueDay: 10, paid: false }], '2026-09', P(2026, 9, 15)), []);
});
await test('virada do mês com o app fechado: as pagas do mês passado voltam a valer, as não pagas viram atrasadas', async () => {
  const b = [{ name: 'Aluguel', amount: 1, dueDay: 15, paid: true }, { name: 'Internet', amount: 1, dueDay: 16, paid: false }];
  assert.deepEqual(names(b, '2026-08', P(2026, 9, 15)), ['Aluguel:0'], 'Internet estava sem pagar em agosto: atrasada, sem aviso de "vence amanhã"');
  assert.deepEqual(names(b, '2026-09', P(2026, 9, 15)), ['Internet:1'], 'no mesmo mês a paga continua paga');
});
await test('vencimento logo depois da virada do mês: a conta paga neste mês avisa antes do dia 1º', async () => {
  const b = [{ name: 'Aluguel', amount: 1, dueDay: 1, paid: true }, { name: 'Escola', amount: 1, dueDay: 2, paid: true }, { name: 'Condomínio', amount: 1, dueDay: 1, paid: false }];
  assert.deepEqual(names(b, '2026-09', P(2026, 9, 29)), ['Aluguel:2', 'Escola:3'], 'Condomínio não paga em setembro: está atrasada');
  assert.deepEqual(names(b, '2026-12', P(2026, 12, 30)), ['Aluguel:2', 'Escola:3'], 'de dezembro para janeiro');
});
await test('dia 31 em mês de 30 dias (e 29/30/31 em fevereiro) vence no último dia do mês', async () => {
  const b = [{ name: 'Seguro', amount: 1, dueDay: 31, paid: false }];
  assert.deepEqual(names(b, '2026-09', P(2026, 9, 29)), ['Seguro:1']); assert.deepEqual(names(b, '2026-09', P(2026, 9, 30)), ['Seguro:0']);
  assert.deepEqual(names(b, '2027-02', P(2027, 2, 27)), ['Seguro:1'], 'fevereiro de 2027 tem 28 dias');
  assert.deepEqual(names(b, '2028-02', P(2028, 2, 28)), ['Seguro:1'], '2028 é bissexto');
});
await test('ordena por proximidade e depois por nome', async () => {
  const b = [{ name: 'Zeta', amount: 1, dueDay: 15, paid: false }, { name: 'Alfa', amount: 1, dueDay: 15, paid: false }, { name: 'Beta', amount: 1, dueDay: 16, paid: false }];
  assert.deepEqual(names(b, '2026-09', P(2026, 9, 15)), ['Alfa:0', 'Zeta:0', 'Beta:1']);
});

/* ================================================================== agendador (cron) */
group('Agendador: quando e o que é enviado');
await test('às 8h de São Paulo envia UM aviso agrupado, com nomes, prazos e valores', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev);
  const res = await runCron(env, D15_0805); assert.equal(sent.length, 1); assert.equal(res.sent, 1);
  const p = payloadOf(sent[0], dev);
  assert.equal(p.title, '3 contas perto de vencer'); assert.equal(p.tag, 'cf-vencimentos-2026-09-15'); assert.equal(p.count, 3);
  const lines = norm(p.body.split('\n').join(' | ')); assert.equal(lines, 'Aluguel — hoje · R$ 1.200,00 | Internet — amanhã · R$ 119,90 | Água — em 3 dias · R$ 95,00');
  checkVapid(sent[0].headers, dev.sub.endpoint);
});
await test('a assinatura VAPID vale a partir do relógio de AGORA, mesmo que o agendamento seja de outra data (senão o serviço de push rejeita o token expirado)', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, {}, AT('2026-09-14T10:00:00Z'));
  await runCron(env, AT('2026-09-15T11:05:00Z')); checkVapid(sent[0].headers, dev.sub.endpoint, Date.now());
});
await test('uma conta só: título no singular', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, { bills: [BILLS[0]] });
  await runCron(env, D15_0805); assert.equal(payloadOf(sent[0], dev).title, '1 conta perto de vencer');
});
await test('antes da hora escolhida não envia; a partir dela envia; depois de enviar não repete no mesmo dia', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, {}, AT('2026-09-14T10:00:00Z'));
  await runCron(env, AT('2026-09-15T10:05:00Z')); assert.equal(sent.length, 0, '07:05');
  await runCron(env, D15_0805); assert.equal(sent.length, 1, '08:05');
  await runCron(env, AT('2026-09-15T12:05:00Z')); await runCron(env, AT('2026-09-15T20:05:00Z')); assert.equal(sent.length, 1, 'mesmo dia');
  await runCron(env, AT('2026-09-16T11:05:00Z')); assert.equal(sent.length, 2, 'dia seguinte: nova lista (15 já não conta, 16/17/18… sim)');
  assert.equal(payloadOf(sent[1], dev).tag, 'cf-vencimentos-2026-09-16');
});
await test('respeita o fuso de cada pessoa: 08:05 em Manaus é 12:05 UTC, não 11:05', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, { tz: 'America/Manaus' }, AT('2026-09-14T10:00:00Z'));
  await runCron(env, AT('2026-09-15T11:05:00Z')); assert.equal(sent.length, 0);
  await runCron(env, AT('2026-09-15T12:05:00Z')); assert.equal(sent.length, 1);
});
await test('a "data de hoje" é a do fuso do usuário, não a UTC (23h em SP já é dia seguinte em UTC)', async () => {
  reset(); const env = makeEnv(), dev = newSub();
  await register(env, dev, { hour: 23, bills: [{ name: 'Aluguel', amount: 1, dueDay: 15, paid: false }] }, AT('2026-09-14T10:00:00Z'));
  await runCron(env, AT('2026-09-16T02:05:00Z'));   // 15/09 23:05 em SP, mas 16/09 em UTC
  assert.equal(sent.length, 1); assert.equal(payloadOf(sent[0], dev).tag, 'cf-vencimentos-2026-09-15'); assert.match(payloadOf(sent[0], dev).body, /hoje/);
});
await test('sem contas perto do vencimento: nada é enviado (e continua podendo avisar depois, se surgir uma)', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, { bills: [BILLS[3]] }, AT('2026-09-14T10:00:00Z'));
  await runCron(env, D15_0805); assert.equal(sent.length, 0); assert.equal(records(env)[0].lastSent, null);
});
await test('muitas contas: mostra 4 e resume o resto ("e mais N")', async () => {
  reset(); const env = makeEnv(), dev = newSub();
  const b = Array.from({ length: 7 }, (_, i) => ({ name: 'Conta ' + (i + 1), amount: 10, dueDay: 15, paid: false }));
  await register(env, dev, { bills: b }, AT('2026-09-14T10:00:00Z')); await runCron(env, D15_0805);
  const p = payloadOf(sent[0], dev); assert.equal(p.title, '7 contas perto de vencer'); assert.equal(p.body.split('\n').length, 5); assert.equal(p.body.split('\n')[4], 'e mais 3');
});
await test('falha do serviço de push (500) não marca como avisado: a próxima rodada tenta de novo', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, {}, AT('2026-09-14T10:00:00Z'));
  respond = () => 500; const r1 = await runCron(env, D15_0805); assert.equal(r1.failed, 1); assert.equal(records(env)[0].lastSent, null);
  respond = () => 201; await runCron(env, AT('2026-09-15T12:05:00Z')); assert.equal(sent.length, 2); assert.equal(records(env)[0].lastSent, '2026-09-15');
});
await test('assinatura expirada (410/404) é apagada; uma falha não impede as outras pessoas de serem avisadas', async () => {
  reset(); const env = makeEnv(), morta = newSub('https://fcm.googleapis.com/fcm/send/gone'), viva = newSub();
  await register(env, morta, {}, AT('2026-09-14T10:00:00Z')); await register(env, viva, {}, AT('2026-09-14T10:00:00Z'));
  respond = url => url.endsWith('/gone') ? 410 : 201;
  const r = await runCron(env, D15_0805); assert.equal(r.removed, 1); assert.equal(r.sent, 1); assert.equal(env.SUBS.m.size, 1); assert.equal(records(env)[0].subscription.endpoint, viva.sub.endpoint);
});
await test('o gatilho scheduled() do Cloudflare roda o mesmo agendador', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, {}, AT('2026-09-14T10:00:00Z'));
  let p; await worker.scheduled({ scheduledTime: D15_0805 }, env, { waitUntil: x => { p = x; } }); await p; assert.equal(sent.length, 1);
});
await test('registro corrompido no KV não derruba o agendador', async () => {
  reset(); const env = makeEnv(), dev = newSub(); await register(env, dev, {}, AT('2026-09-14T10:00:00Z'));
  env.SUBS.m.set('sub:lixo', { value: '{nao é json' }); env.SUBS.m.set('sub:vazio', { value: 'null' });
  const r = await runCron(env, D15_0805); assert.equal(r.sent, 1);
});

globalThis.fetch = realFetch;
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
