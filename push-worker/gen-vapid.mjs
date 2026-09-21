#!/usr/bin/env node
/*
 * Gera o par de chaves VAPID (P-256) que identifica o seu Worker perante os serviços de push.
 *
 *   node push-worker/gen-vapid.mjs
 *
 * A chave PÚBLICA vai no wrangler.toml (VAPID_PUBLIC_KEY). A PRIVADA é segredo: só vai para o Cloudflare
 * com `npx wrangler secret put VAPID_PRIVATE_KEY`. Não a salve em arquivo nem no repositório. Gere o par UMA vez:
 * trocar as chaves invalida todas as assinaturas (é preciso ativar os avisos de novo em cada aparelho).
 */
import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');

console.log('VAPID_PUBLIC_KEY  (vai no wrangler.toml):');
console.log(pub);
console.log('\nVAPID_PRIVATE_KEY (SEGREDO: cole quando o wrangler pedir em `npx wrangler secret put VAPID_PRIVATE_KEY`):');
console.log(jwk.d);
