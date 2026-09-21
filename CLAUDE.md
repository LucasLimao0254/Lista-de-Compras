# CLAUDE.md

Controle Financeiro: PWA de página única (HTML+CSS+JS puro, sem build, sem backend) com
lista de compras, despesas fixas, controle de mercado e comparador de preços.

Leia `HANDOFF.md` antes de mexer — ele descreve a arquitetura, as chaves de storage, o que já
está implementado e o fluxo de validação.

## Cuidado ao inspecionar `index.html`

O arquivo tem ~1.7MB porque o `pdf.js` e seu worker estão embutidos, **cada um em uma única
linha gigante**. Nunca rode `grep -n` / `Read` sem restringir: use `grep -oE` (só o trecho casado)
ou filtre linhas por tamanho. Os módulos próprios estão nos `<script>` sem atributos.

## Estilo (sistema Nocturne)

O CSS segue o design system Nocturne. Os tokens em `:root` têm os nomes do design system
**e** os nomes antigos (`--bg`, `--panel`, `--accent`, `--s1…--s8`) como aliases: o JS lê
esses nomes por `cssColor('--s1')`, então não os renomeie. Sem `oklch()`/`color-mix()` (iOS
antigo) e sem fonte externa (a Inter está embutida em base64). Detalhes em `HANDOFF.md`.

## Armadilhas (todas já causaram bug e têm teste em `tests/e2e.js`)

- **Datas sempre no horário local.** Nunca use `toISOString()` para "hoje" ou "mês atual": ele é UTC e, no Brasil, vira o
  dia às 21h. Use o `isoDate()` do módulo de mercado (getters locais).
- **Só limpe um formulário quando a operação deu certo.** `addItem` devolve `true`/`false`; em erro de validação o texto
  digitado deve ficar.
- **Não redesenhe a lista inteira ao editar um campo** (o foco se perde). Atualize só o trecho afetado, como `fillPrices`.
- **Valores em reais** aceitam `1.299,90`, `1.299`, `R$ 349,90` e `349.90`: use a mesma regra de `parseAmount` (despesas).
- **Chaves compostas** como `data|loja` podem conter o separador no nome da loja: separe só no primeiro `|` (`splitTripKey`).
- **Campos de texto com 16px no celular** (regra `@media (pointer: coarse)`), senão o iPhone dá zoom ao focar.
- **Despesas mudam de mês sozinhas** (`applyMonthRollover`): pagas voltam a pendente, não pagas acumulam `unpaidMonths`.
  Qualquer novo fluxo que leia `paid` deve usar `monthsUnpaid()`/`isOverdue()` em vez de comparar só o dia.
- **Lista de desejos: o preço do link é derivado do histórico.** Nunca escreva `link.price` direto: use `addEntry`/
  `syncLink` (ordena o histórico por data e recalcula o preço atual). Registro em data anterior usa meio-dia local
  (não vira o preço atual); data futura é recusada; hoje usa `Date.now()`. Não há leitura automática de preço
  (Amazon/Mercado Livre/Magalu bloqueiam) — tudo é digitado pelo usuário.
- **Modais** ganham foco, prisão de Tab e retorno de foco automaticamente (observador em `.overlay`); ao criar um modal novo,
  inclua-o na lista `modalOverlays` e dê `role="dialog"`, `aria-modal` e um nome.
- **Avisos por push:** a regra de "perto de vencer" existe em `dueSoonDays` (app) **e** em `dueBills` (`push-worker/worker.mjs`); mude as
  duas juntas. Todo `push` no `service-worker.js` tem de acabar em `showNotification` (senão iOS/Chrome revogam a permissão), e o
  destino do clique nunca vem do conteúdo do push. O endereço de push recebido pelo Worker só é chamado se for de Google/Apple/Mozilla/
  Microsoft (anti-SSRF), e só o `ALLOWED_ORIGINS` fala com ele: não afrouxe. Os testes `px-` do e2e usam um stub (`PUSH_STUB`).
- **Fim de linha:** os arquivos do repositório estão em CRLF no Windows (`core.autocrlf`); scripts que editam por substituição de texto
  precisam normalizar `\r\n` antes de casar trechos.

## Rodar localmente

O service worker exige HTTP (não funciona em `file://`):

```bash
npx serve .
```

## Validar antes de entregar

- **Testes:** `npm test` (só Node ≥ 22 e um Chrome/Edge; sem dependências). Roda antes `tests/push-worker.test.mjs` (Worker de push: cifragem, VAPID, regras de vencimento, cron, API) e `tests/service-worker.test.mjs` (push/click/cache, em `node:vm`), depois `tests/e2e.js`: sobe o app, fixa a
  data em 15/09/2026 e usa dados fictícios, então é determinístico e nunca toca em dados reais. Cobre Visão geral/sino,
  despesas, lista de desejos, mercado, comparador, primeiro uso, layout (320–1280 px), tokens de CSS,
  "nenhum recurso externo", fuso horário à noite, arrastar e soltar e o app abrindo offline (service worker).
  Ao achar um bug, escreva o teste que falha primeiro e só então corrija.
  `TEST_INDEX=outro.html npm test` roda contra uma cópia (útil para conferir que o teste pega um defeito).
  `TEST_FILTER="^push:" node tests/e2e.js` roda só os testes cujo nome casar (combine com `TEST_INDEX` para testar um defeito isolado sem esperar a suíte toda).

- Sintaxe: extrair os `<script>` sem atributos (`/<script>([\s\S]*?)<\/script>/g`) e rodar `node --check` em cada um.
- IDs duplicados: `grep -oE 'id="[a-zA-Z0-9_-]+"' index.html | sort | uniq -c | sort -rn`.
- Ao alterar `index.html` ou os assets, incrementar `CACHE_NAME` em `service-worker.js` se a lista de `ASSETS` mudar.
