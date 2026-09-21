/*
 * Worker de avisos por push do Controle Financeiro (Cloudflare Workers, plano gratuito).
 *
 * O app é um PWA sem servidor: quando fechado, ele não consegue avisar nada. Este Worker é o "relógio" que
 * faltava. O app manda para cá (1) a assinatura de push do aparelho e (2) a lista de contas (nome, valor, dia
 * do vencimento, se está paga); a cada hora o Worker confere quem está perto de vencer e envia um Web Push
 * (RFC 8030) com o payload cifrado (RFC 8291) e identificado por VAPID (RFC 8292). Só WebCrypto: sem dependências.
 *
 * Rotas (todas exigem o cabeçalho Origin do app, ver ALLOWED_ORIGINS):
 *   GET  /vapid         -> { publicKey }
 *   POST /subscribe     -> grava/atualiza { subscription, bills, cycle, tz, hour, leadDays }
 *   POST /unsubscribe   -> apaga a assinatura
 *   POST /test          -> envia agora uma notificação de teste e devolve a resposta do serviço de push
 *
 * Variáveis: SUBS (KV), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: ou https:),
 *            ALLOWED_ORIGINS (opcional; padrão https://lucaslimao0254.github.io), MAX_SUBS (opcional; padrão 10).
 */

const DEFAULT_ORIGINS = 'https://lucaslimao0254.github.io';
const DEFAULT_MAX_SUBS = 10;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BILLS = 500;
const SUB_TTL_SECONDS = 180 * 24 * 3600;   // renovado a cada sincronização do app
const PUSH_TTL_SECONDS = 12 * 3600;        // um aviso de hoje não serve amanhã
const MAX_LINES = 4;

// Só estes serviços de push são chamados: o endereço vem do cliente, então sem esta lista o Worker
// poderia ser usado para fazer requisições para qualquer lugar (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

const enc = new TextEncoder();
const subtle = crypto.subtle;

/* ------------------------------------------------------------------ bytes */
const b64u = {
  encode(bytes) {
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
    const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, bytes) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/* ------------------------------------------------------------------ Web Push: cifragem (RFC 8291, aes128gcm) */
export async function encryptPayload(subscription, plaintext, opts = {}) {
  const uaPublic = b64u.decode(subscription.keys.p256dh);   // chave pública do navegador (65 bytes)
  const authSecret = b64u.decode(subscription.keys.auth);   // segredo de autenticação (16 bytes)
  const curve = { name: 'ECDH', namedCurve: 'P-256' };

  let asPrivate, asPublic;   // par efêmero do servidor (opts.ephemeralJwk só existe para o vetor de teste da RFC)
  if (opts.ephemeralJwk) {
    asPrivate = await subtle.importKey('jwk', opts.ephemeralJwk, curve, false, ['deriveBits']);
    asPublic = concat(Uint8Array.of(4), b64u.decode(opts.ephemeralJwk.x), b64u.decode(opts.ephemeralJwk.y));
  } else {
    const pair = await subtle.generateKey(curve, true, ['deriveBits']);
    asPrivate = pair.privateKey; asPublic = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  }
  const uaKey = await subtle.importKey('raw', uaPublic, curve, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const data = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, Uint8Array.of(2));   // 0x02 = último (e único) registro
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  return concat(salt, Uint8Array.of(0, 0, 0x10, 0), Uint8Array.of(asPublic.length), asPublic, ciphertext);   // rs = 4096
}

/* ------------------------------------------------------------------ Web Push: VAPID (RFC 8292) */
async function vapidHeader(endpoint, env) {
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const pub = b64u.decode(env.VAPID_PUBLIC_KEY);
  const key = await subtle.importKey('jwk',
    { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims)));   // r||s, formato do JWT
  return 'vapid t=' + head + '.' + claims + '.' + b64u.encode(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

// Envia um push; devolve o status HTTP do serviço de push (201 = aceito).
async function sendPush(subscription, payload, env) {
  const body = await encryptPayload(subscription, JSON.stringify(payload));
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, env),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(PUSH_TTL_SECONDS), Urgency: 'normal',
    },
    body,
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
  });
  return res.status;
}

/* ------------------------------------------------------------------ datas no fuso do usuário */
function localParts(ms, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour };
}
const pad2 = n => String(n).padStart(2, '0');
const dateKey = p => p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
const monthKey = p => p.y + '-' + pad2(p.m);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length > 0; } catch (e) { return false; } };

/* ------------------------------------------------------------------ quais contas avisar */
// Mesmas regras do app (dueSoonDays), mais a virada do mês porque o app pode estar fechado há dias:
//  - paga neste mês = não avisa; paga no mês ANTERIOR (ciclo antigo) volta a pendente
//  - não paga no mês anterior, ou com 2+ meses sem pagar = já está atrasada, não é "perto de vencer"
//  - a conta paga neste mês cujo dia já passou avisa antes do vencimento do mês que vem (ex.: dia 1º)
export function dueBills(record, parts) {
  const dim = daysInMonth(parts.y, parts.m);
  const next = parts.m === 12 ? [parts.y + 1, 1] : [parts.y, parts.m + 1];
  const nextDim = daysInMonth(next[0], next[1]);
  const stale = !!record.cycle && record.cycle < monthKey(parts);   // as marcas de "pago" são de um mês que já acabou
  const out = [];
  for (const b of record.bills || []) {
    if (!b || !b.dueDay) continue;
    const paidNow = !!b.paid && !stale;
    const late = !b.paid && (stale || (b.unpaidMonths || 1) > 1);
    let diff;
    const due = Math.min(b.dueDay, dim);
    if (due >= parts.d) {
      if (paidNow || late) continue;
      diff = due - parts.d;
    } else {
      if (!paidNow) continue;   // venceu neste mês e não foi paga: atrasada
      diff = (dim - parts.d) + Math.min(b.dueDay, nextDim);
    }
    if (diff <= record.leadDays) out.push({ name: b.name, amount: b.amount, diff });
  }
  return out.sort((a, b) => a.diff - b.diff || a.name.localeCompare(b.name, 'pt-BR'));
}

const when = d => d === 0 ? 'hoje' : d === 1 ? 'amanhã' : 'em ' + d + ' dias';
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
function buildPayload(list, parts) {
  const lines = list.slice(0, MAX_LINES).map(b => b.name + ' — ' + when(b.diff) + (b.amount > 0 ? ' · ' + brl(b.amount) : ''));
  if (list.length > MAX_LINES) lines.push('e mais ' + (list.length - MAX_LINES));
  return {
    title: list.length === 1 ? '1 conta perto de vencer' : list.length + ' contas perto de vencer',
    body: lines.join('\n'), tag: 'cf-vencimentos-' + dateKey(parts), count: list.length,
  };
}

/* ------------------------------------------------------------------ agendador */
export async function runCron(env, scheduledTime) {
  const res = { checked: 0, sent: 0, removed: 0, failed: 0 };
  const keys = []; let cursor;
  do { const page = await env.SUBS.list({ prefix: 'sub:', cursor }); keys.push(...page.keys.map(k => k.name)); cursor = page.list_complete ? undefined : page.cursor; } while (cursor);

  for (const key of keys) {
    try {
      const record = await env.SUBS.get(key, 'json');
      if (!record || !record.subscription || !validTz(record.tz)) continue;
      res.checked++;
      const parts = localParts(scheduledTime, record.tz);
      if (parts.h < record.hour || record.lastSent === dateKey(parts)) continue;   // ainda não é a hora / já avisou hoje
      const list = dueBills(record, parts);
      if (!list.length) continue;
      const status = await sendPush(record.subscription, buildPayload(list, parts), env);
      if (status >= 200 && status < 300) {
        record.lastSent = dateKey(parts);
        await env.SUBS.put(key, JSON.stringify(record), { expirationTtl: SUB_TTL_SECONDS });
        res.sent++;
      } else if (status === 404 || status === 410) { await env.SUBS.delete(key); res.removed++; }
      else res.failed++;   // 429/5xx/…: não marca como avisado, a próxima hora tenta de novo
    } catch (e) { res.failed++; }
  }
  return res;
}

/* ------------------------------------------------------------------ API HTTP */
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers) });

function endpointAllowed(endpoint) {
  let u; try { u = new URL(endpoint); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
}
function validSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !endpointAllowed(s.endpoint) || !s.keys) return null;
  try {
    const p = b64u.decode(s.keys.p256dh), a = b64u.decode(s.keys.auth);
    if (p.length !== 65 || p[0] !== 4 || a.length !== 16) return null;
  } catch (e) { return null; }
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
const cleanText = s => String(s).replace(/[ -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
function validBills(list) {
  if (!Array.isArray(list) || list.length > MAX_BILLS) return null;
  const out = [];
  for (const b of list) {
    if (!b || typeof b.name !== 'string' || !cleanText(b.name)) return null;
    if (!Number.isInteger(b.dueDay) || b.dueDay < 1 || b.dueDay > 31) return null;
    if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount < 0 || b.amount > 1e9) return null;
    out.push({ name: cleanText(b.name), amount: b.amount, dueDay: b.dueDay, paid: b.paid === true, unpaidMonths: Number.isInteger(b.unpaidMonths) && b.unpaidMonths > 0 && b.unpaidMonths < 1000 ? b.unpaidMonths : 1 });
  }
  return out;
}
async function sha256Hex(text) { return [...new Uint8Array(await subtle.digest('SHA-256', enc.encode(text)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

function parseSettings(body) {
  const hour = body.hour === undefined ? 8 : body.hour, leadDays = body.leadDays === undefined ? 3 : body.leadDays;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(leadDays) || leadDays < 0 || leadDays > 7) return null;
  if (typeof body.tz !== 'string' || !validTz(body.tz)) return null;
  if (body.cycle !== undefined && body.cycle !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.cycle)) return null;
  return { hour, leadDays, tz: body.tz, cycle: body.cycle || null };
}

export async function handleRequest(request, env, now = Date.now()) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return json({ error: 'origem não permitida' }, 403);
  const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
  const reply = (obj, status) => json(obj, status, cors);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, cors) });

  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (path === '/vapid') return request.method === 'GET' ? reply({ publicKey: env.VAPID_PUBLIC_KEY }, 200) : reply({ error: 'método não permitido' }, 405);
  if (!['/subscribe', '/unsubscribe', '/test'].includes(path)) return reply({ error: 'não encontrado' }, 404);
  if (request.method !== 'POST') return reply({ error: 'método não permitido' }, 405);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reply({ error: 'corpo grande demais' }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return reply({ error: 'JSON inválido' }, 400); }
  if (!body || typeof body !== 'object') return reply({ error: 'JSON inválido' }, 400);
  const subscription = validSubscription(body.subscription);
  if (!subscription) return reply({ error: 'assinatura de push inválida' }, 400);
  const key = 'sub:' + await sha256Hex(subscription.endpoint);

  if (path === '/unsubscribe') { await env.SUBS.delete(key); return reply({ ok: true }, 200); }

  if (path === '/test') {
    const status = await sendPush(subscription, { title: 'Aviso de teste', body: 'Está funcionando: você vai receber um aviso quando uma conta estiver perto de vencer.', tag: 'cf-teste', count: 0 }, env);
    if (status >= 200 && status < 300) return reply({ ok: true, status }, 200);
    if (status === 404 || status === 410) { await env.SUBS.delete(key); return reply({ ok: false, status, error: 'A assinatura expirou. Desative e ative os avisos de novo.' }, 502); }
    return reply({ ok: false, status, error: 'O serviço de push recusou o envio (HTTP ' + status + ').' }, 502);
  }

  // /subscribe
  const settings = parseSettings(body), bills = validBills(body.bills);
  if (!settings || !bills) return reply({ error: 'dados inválidos' }, 400);
  const existing = await env.SUBS.get(key, 'json').catch(() => null);
  if (!existing) {
    const max = Number(env.MAX_SUBS) || DEFAULT_MAX_SUBS; let count = 0, cursor;
    do { const page = await env.SUBS.list({ prefix: 'sub:', cursor }); count += page.keys.length; cursor = page.list_complete ? undefined : page.cursor; } while (cursor);
    if (count >= max) return reply({ error: 'limite de aparelhos atingido neste Worker' }, 429);
  }
  const parts = localParts(now, settings.tz);
  const record = {
    subscription, bills, cycle: settings.cycle, tz: settings.tz, hour: settings.hour, leadDays: settings.leadDays,
    // quem ativa depois da hora de avisar só começa a ser avisado amanhã (sem aviso de surpresa)
    lastSent: existing ? existing.lastSent : (parts.h >= settings.hour ? dateKey(parts) : null),
    updatedAt: now,
  };
  await env.SUBS.put(key, JSON.stringify(record), { expirationTtl: SUB_TTL_SECONDS });
  return reply({ ok: true }, 200);
}

export default {
  fetch: (request, env) => handleRequest(request, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runCron(env, event.scheduledTime)); },
};
