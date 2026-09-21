# Avisos por push: conta perto de vencer

O app é uma página sem servidor: com ele fechado, nada roda e nada pode avisar. Este **Worker** (Cloudflare Workers, plano
gratuito, criado por você) é o relógio que faltava: a cada hora ele confere as suas contas e, quando alguma está perto de
vencer, manda uma notificação para o celular, **mesmo com o app fechado**.

## O que o Worker guarda (e o que não guarda)

Guarda, por aparelho ativado: a assinatura de push (o "endereço" do aparelho), o **nome, o valor e o dia de vencimento** das
contas, se cada uma está paga, o mês a que as marcações de "pago" se referem, o fuso horário, o horário e a antecedência que
você escolheu. Nada de categoria, anotações, lista de compras, mercado nem lista de desejos.

Os dados ficam na **sua** conta da Cloudflare (KV). Só o site do app (`ALLOWED_ORIGINS`) consegue falar com o Worker, ele só envia
push para serviços conhecidos (Google, Apple, Mozilla e Microsoft) e aceita no máximo 10 aparelhos (`MAX_SUBS`).

## Criar o Worker (uma vez só, uns 10 minutos)

Precisa de [Node.js](https://nodejs.org) 22 ou mais novo e de uma conta gratuita na Cloudflare
(<https://dash.cloudflare.com/sign-up>). No terminal, dentro da pasta `push-worker`:

1. **Gere as chaves VAPID** (identificam o seu Worker perante os serviços de push):

   ```bash
   node gen-vapid.mjs
   ```

   Anote as duas linhas. A **pública** vai no `wrangler.toml`; a **privada** é segredo (não salve em arquivo nem no repositório).
   Gere o par uma vez só: trocar as chaves depois obriga a ativar os avisos de novo em cada aparelho.

2. **Entre na Cloudflare** (abre o navegador):

   ```bash
   npx wrangler login
   ```

3. **Crie o armazenamento** e copie o `id` que ele mostrar para o `wrangler.toml` (linha `id = "COLE_AQUI_O_ID_DO_KV"`).
   (Em versões antigas do wrangler o comando é `kv:namespace create SUBS`.)

   ```bash
   npx wrangler kv namespace create SUBS
   ```

4. **Edite o `wrangler.toml`**: troque `VAPID_SUBJECT` pelo seu e-mail (`mailto:voce@exemplo.com`) e cole a chave **pública** em
   `VAPID_PUBLIC_KEY`. `ALLOWED_ORIGINS` já aponta para `https://lucaslimao0254.github.io`; se o seu app estiver em outro endereço, troque.

5. **Guarde a chave privada como segredo** (o wrangler pergunta o valor, cole a linha "VAPID_PRIVATE_KEY"):

   ```bash
   npx wrangler secret put VAPID_PRIVATE_KEY
   ```

6. **Publique**:

   ```bash
   npx wrangler deploy
   ```

   No fim ele mostra o endereço, algo como `https://controle-financeiro-avisos.SEU-USUARIO.workers.dev`.

7. **No app**: menu → *Despesas fixas* → *Avisos por push* → cole o endereço → **Ativar avisos** → *Permitir*.
   Depois toque em **Enviar aviso de teste**: é assim que você confirma, no seu aparelho, que o caminho inteiro funciona.

### iPhone / iPad

O Safari só oferece push a apps **instalados na tela inicial**, com **iOS 16.4 ou mais novo**: abra o app no Safari →
Compartilhar → *Adicionar à Tela de Início*, abra pelo ícone novo e só então ative os avisos (dentro do Safari comum o botão
avisa que não há suporte). Em Ajustes → Notificações o app precisa estar liberado.

## Como o aviso funciona

- O Worker roda **a cada hora** e, para cada aparelho, só age depois do **horário escolhido** (padrão 8h, no fuso do aparelho).
- Manda **um aviso por dia**, agrupando as contas: "3 contas perto de vencer" com `Aluguel — hoje · R$ 1.200,00`,
  `Internet — amanhã`, `Água — em 3 dias`. Se o envio falhar, tenta de novo na hora seguinte.
- Entram as contas **não pagas** que vencem de hoje até a antecedência escolhida (0 a 7 dias, padrão 3). Ficam de fora: as já
  pagas neste mês, as que já venceram (atrasadas) e as que acumulam mais de um mês sem pagamento.
- **Virada do mês com o app fechado:** o Worker sabe a que mês as marcações de "pago" se referem. Passando para um mês novo, as
  contas pagas voltam a valer como pendentes; as que ficaram sem pagar viram atrasadas. Uma conta paga neste mês cujo dia já
  passou avisa antes do vencimento do mês seguinte (ex.: aluguel no dia 1º, avisado no dia 29).
- Dia 31 em mês de 30 dias (e 29/30/31 em fevereiro) vence no último dia do mês.
- O app envia a lista atualizada ao Worker sempre que você marca/edita/adiciona uma conta (com um pequeno atraso), ao abrir, ao
  voltar para o app e quando a internet volta. **Se você marcar uma conta como paga e o celular estiver sem internet, o Worker
  só fica sabendo quando o app voltar a se conectar.** Até lá ele ainda pode avisar dessa conta.
- A assinatura expira sozinha no Worker se o app ficar 180 dias sem ser aberto.

## Desativar ou apagar

- No app: **Desativar avisos** (cancela no aparelho e apaga do Worker).
- Apagar tudo: `npx wrangler delete` (remove o Worker); o KV pode ser removido no painel da Cloudflare.

## Limites e o que foi (e não foi) testado

- **Custo:** o plano gratuito da Cloudflare cobre uso pessoal com folga (o Worker roda 24 vezes por dia e só grava quando você
  muda alguma conta).
- **Chegada do aviso:** depende do serviço de push do sistema (Google, Apple, Microsoft). Ele pode atrasar alguns minutos.
- **Testado automaticamente** (`npm test`): a cifragem do aviso contra o vetor da RFC 8291 e uma decifragem independente, a
  assinatura VAPID (RFC 8292), todas as regras de quais contas avisam (virada de mês, fusos, fim de mês), o agendador, a API, os
  limites de segurança e o app (permissão, assinatura, sincronização) com o navegador e o Worker simulados.
- **Testado de verdade uma vez:** o código do Worker enviou o aviso de teste e um aviso agrupado do agendador ao serviço de push
  real da Microsoft (WNS), e o Edge os recebeu e decifrou. Isso valida a cifragem e a assinatura VAPID contra um serviço de verdade.
- **Não testado:** Google (Chrome/Android), Apple (iPhone) e a implantação no Cloudflare, porque isso exige o seu aparelho e o seu
  Worker publicado. Use o botão **Enviar aviso de teste**. Se ele acusar "recusou o envio (HTTP 401/403)", confira se a chave
  pública do `wrangler.toml` é a par da privada que você guardou e se `VAPID_SUBJECT` é um e-mail válido (`mailto:...`).
