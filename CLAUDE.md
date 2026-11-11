# CLAUDE.md

Controle Financeiro: PWA de página única (HTML+CSS+JS puro, sem build, sem backend) com
lista de compras, despesas fixas, controle de mercado e comparador de preços.

Leia `HANDOFF.md` antes de mexer — ele descreve a arquitetura, as chaves de storage, o que já
está implementado e o fluxo de validação.

## Cuidado ao inspecionar `index.html`

O arquivo tem ~340 KB. A fonte Inter está embutida em base64 numa **única linha de ~64 KB** dentro do
`<style>`: nunca rode `grep -n` / `Read` sem restringir (use `grep -oE` ou filtre linhas por tamanho).
Os módulos próprios estão nos `<script>` sem atributos. As bibliotecas de terceiros ficam em `vendor/`
(`pdf.min.js`, `pdf.worker.min.js`, `jsQR.js`), carregadas sob demanda; não as embuta de volta no HTML
(1,5 MB analisados em toda abertura).

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
- **Um diálogo por vez.** `appAlert`/`appConfirm` entram numa fila (`dialogQueue`): nunca mexa no overlay direto, senão um aviso
  troca o texto de uma confirmação aberta e o "OK" confirma a ação errada.
- **Editar não reclassifica.** `saveEdit` (compras e despesas) só troca a categoria quando o nome mudou **e** o item ainda estava na
  categoria automática; e só altera o item depois de validar tudo.
- **Vencimentos:** use `dueSoonDays()`, `dueDayThisMonth()` e `isOverdue()`; nunca compare `dueDay` com o dia de hoje direto (dia 31
  em mês curto vence no último dia; conta já paga avisa do vencimento do mês seguinte). O sino mostra atrasadas (`CF.expenses.overdue`)
  além das que vencem em breve.
- **O dia muda com o app aberto** (PWA retomado, não recarregado): `refreshIfDayChanged` chama `CF.expenses.refresh` e
  `CF.market.refresh`. Tela nova que dependa de "hoje" precisa entrar ali, sem apagar o que o usuário está digitando.
- **Service worker:** só pedidos da mesma origem passam pelo cache, e a página do app só substitui uma *navegação* sem rede.
  Devolver o `index.html` para qualquer pedido que falha faz um erro parecer sucesso (aconteceu na busca da NFC-e).
- **Avisos das telas** (`showStatus`) são `.toast` fixos no rodapé com `role="status"`; não volte a pôr a mensagem no fim da página.
- **Todo campo precisa de nome acessível** (`<label for>` ou `aria-label`) e caixa de marcar usa `window.cfCheckbox`: há um teste
  que percorre todos os campos da página.
- **QR Code da NFC-e** (`startScan`/`scanPhoto`): a câmera **tem de ser desligada** em todo caminho de saída (`stopScan`: Parar,
  fechar o modal, Esc, app em segundo plano, permissão que chega depois do fechamento — `scanToken`). O texto lido é dado, não
  comando: só entra no campo se tiver chave de 44 dígitos e só é buscado sozinho se o link for `gov.br`. O decodificador é
  `vendor/jsQR.js` (carregado sob demanda, listado em `ASSETS` do service worker); não use `BarcodeDetector` (não existe no iPhone).
- **Backup** (menu → Seus dados): `BK_KEYS` lista as chaves exportadas/restauradas. **Chave de storage nova tem de entrar ali**, senão
  fica fora do backup. Restaurar substitui tudo e recarrega; por isso os carregadores de cada módulo descartam item inválido em vez de
  confiar no arquivo.
- **Marcar item/conta não chama `render()`:** `toggleItem` troca só o `<li>` (`buildLi`) e atualiza totais. Se criar algo na tela que
  dependa de marcado/pago, atualize-o em `updateProgress`/`updateSummary`, não só no `render()`.
- **Excluir item/conta usa `window.cfUndo`** (some na hora, aviso "Desfazer" por 7 s), não `appConfirm`. Confirmação fica para o que
  não tem volta simples (categoria, ida ao mercado, item de desejos, restaurar backup).
- **Navegação:** barra inferior (`#bottomNav`, `data-nav`) no celular, menu fixo a partir de 960 px; o menu lateral continua existindo
  (Comparador e backup só estão nele). `goToView` atualiza os três. Avisos (`.toast`, `.undo-toast`) ficam acima da barra.
- **Alvos de toque:** todo controle tem pelo menos 40 px (teste `fl: todo controle tocável`). Ao criar botão/link novo, confira.
- **Código compartilhado das listas:** arrastar (`cfDragList`) e painel de categorias (`cfRenderCategoriesPanel`) ficam no primeiro
  `<script>`; Compras e Despesas só passam os dados. Não volte a copiar esse código para dentro de um módulo.
- **Categoria automática:** use `window.cfHasKeyword` (início de palavra; até 3 letras, palavra inteira), nunca `includes`.
- **Formulário de compra do Mercado:** fechar com algo digitado pede confirmação (`requestCloseModal`); só `closeModal()` direto depois de salvar.

## Rodar localmente

O service worker exige HTTP (não funciona em `file://`):

```bash
npx serve .
```

## Validar antes de entregar

- **Testes:** `npm test` (só Node ≥ 22 e um Chrome/Edge; sem dependências). Roda `tests/e2e.js`: sobe o app, fixa a
  data em 15/09/2026 e usa dados fictícios, então é determinístico e nunca toca em dados reais. Cobre Visão geral/sino,
  despesas, lista de desejos, mercado, comparador, primeiro uso, layout (320–1280 px), tokens de CSS,
  "nenhum recurso externo", fuso horário à noite, arrastar e soltar e o app abrindo offline (service worker).
  Ao achar um bug, escreva o teste que falha primeiro e só então corrija.
  `TEST_INDEX=outro.html npm test` roda contra uma cópia (útil para conferir que o teste pega um defeito).
  `TEST_FILTER="^rev2:" node tests/e2e.js` roda só os testes cujo nome casar com a expressão regular.
  Prefixos dos grupos mais novos: `qr:` (QR Code), `rev3:`, `bk:` (backup), `fl:` (fluidez), `ut:` (utilidade), `es:` (estrutura/computador).

- Sintaxe: extrair os `<script>` sem atributos (`/<script>([\s\S]*?)<\/script>/g`) e rodar `node --check` em cada um.
- IDs duplicados: `grep -oE 'id="[a-zA-Z0-9_-]+"' index.html | sort | uniq -c | sort -rn`.
- Ao alterar `index.html` ou os assets, incrementar `CACHE_NAME` em `service-worker.js` se a lista de `ASSETS` mudar
  (inclui os arquivos de `vendor/`: se algum for atualizado, o cache precisa mudar de versão).
