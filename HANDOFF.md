# Controle Financeiro — handoff para o Claude Code

Este documento existe pra outra sessão (agora no Claude Code) continuar o projeto
sem precisar do histórico do chat onde ele foi construído. Junto com este `.md`,
o pacote traz o app pronto pra virar um repositório: `index.html`, `manifest.json`,
`service-worker.js` e os 4 ícones.

## O que é o projeto

App web de página única (HTML+CSS+JS puro, sem build, sem backend) que substitui
três controles separados por um só, com navegação por menu lateral:

1. **Visão Geral** — total já desembolsado no mês (número principal) com barra
   segmentada (contas pagas / mercado / contas pendentes) e um cartão-resumo de
   cada módulo. O **sino de notificações** do cabeçalho junta os alertas: contas
   vencendo nos próximos dias e quedas de preço da Lista de Desejos.
2. **Lista de Compras** — checklist com categorização automática por palavra-chave,
   drag-and-drop entre categorias, e autocompletar baseado no histórico de itens
   já digitados. Mostra uma **estimativa de valor** dos itens pendentes, cruzando
   o nome do item com o histórico de preços do Controle de Mercado.
3. **Despesas Fixas** — contas mensais recorrentes, com categorização automática,
   dia de vencimento, e alerta visual quando uma conta vence nos próximos 3 dias
   (além do destaque já existente pra contas já vencidas).
4. **Controle de Mercado** — o módulo mais complexo: histórico de compras de
   mercado com KPIs, gráfico de gasto por categoria (rosca), gráfico de gasto por
   loja ao longo do tempo (linha), meta de gasto mensal, comparação de preço de
   um produto entre lojas (com gráfico de evolução de preço ao longo do tempo),
   e um importador de notas fiscais (NFC-e) que lê PDF automaticamente.
5. **Comparador de Preços** — calculadora avulsa (não salva nada) tipo "regra de
   três": compara preço por quantidade entre produtos parecidos (ex: R$10/100ml
   vs R$8/750ml) e diz qual rende mais por litro/quilo/unidade.
6. **Lista de Desejos** — itens que o usuário quer comprar, cada um com um **valor
   esperado** e uma lista de **links dos anúncios**. O preço de cada link é **sempre
   informado à mão** (o app não lê preço de site: Amazon, Mercado Livre e Magalu bloqueiam
   leitura automática): ao criar o item ou adicionar um link o usuário digita o preço
   listado, e depois pode **registrar um novo preço** (hoje, ou numa data anterior para
   completar o histórico). Cada link guarda seu **histórico de preços** (data + valor, com
   variação ↓/↑ e exclusão de registros); o preço atual é o registro mais recente.
   O item mostra a **média** e o **menor preço** entre os preços atuais dos links que têm preço;
   quando o menor fica abaixo do valor esperado (destacado em verde), conta como "queda de preço" (aparece no sino e na
   Visão Geral). Só links `http(s)` viram `<a>`; qualquer outro esquema (`javascript:` etc.)
   é exibido como texto.

## Arquitetura

Um único arquivo `index.html` com:
- `<style>` único no `<head>` com todo o CSS, no visual do sistema **Nocturne**
  (tema escuro, roxo `#9184d9`, botões só contornados, cards sem borda). Os tokens
  ficam em `:root` com os nomes do design system (`--color-bg`, `--color-accent`,
  `--color-neutral-*`…) **e** os nomes antigos (`--bg`, `--panel`, `--accent`,
  `--s1…--s8`…) como aliases — o JS lê esses nomes (`cssColor('--s1')` etc.), então
  não os renomeie. Cores estão em hex/rgba (não `oklch()`/`color-mix()`) para
  funcionar em iOS mais antigo. A fonte **Inter** (latin, variável, SIL OFL) está
  embutida em base64 no `@font-face` para o app seguir 100% offline. Há uma única
  `@media (min-width: 720px)` (coluna central de até 720px, tipografia maior).
- Um `<script>` compartilhado no topo com a camada de storage
  (`storageGet`/`storageSet`, que usa `window.storage` quando existe — ambiente
  de artifact do Claude — ou cai pra `localStorage` fora dele) e um diálogo
  próprio de confirmar/alertar (`window.appConfirm`/`window.appAlert`), porque o
  `confirm()`/`alert()` nativo do navegador pode ser bloqueado silenciosamente em
  alguns ambientes de preview em iframe.
- **Seis módulos independentes**, cada um num `<script>` próprio, envolto numa
  IIFE `(function(){...})()` — isso evita colisão de nomes de variável entre eles
  (cada um pode ter sua própria `items`, `render()`, etc. sem conflito). Os IDs de
  elemento no DOM são prefixados por módulo: `sc-` (compras), `ex-` (despesas),
  `mk-` (mercado), `cp-` (comparador), `wl-` (desejos).
- Os quatro módulos com dados persistentes (compras, despesas, mercado, desejos)
  expõem `window.CF.<modulo>.init()` (carrega do storage) e `.summary()` (resumo
  read-only pra Visão Geral usar). O mercado também expõe `.getPriceIndex()`,
  usado pela Lista de Compras pra estimar preços; despesas expõe `.dueSoon()` e
  desejos expõe `.priceDrops()`, que alimentam o sino de notificações.
- O script final de navegação (menu lateral, troca de `view`, sino de notificações)
  faz `Promise.all([...init() dos 4 módulos...])` e só depois renderiza a Visão Geral.
  Qualquer módulo que altere dados relevantes para o sino chama
  `window.CF.refreshAlerts()` (definida nesse script) para atualizá-lo na hora.
- Dois `<script>` com bibliotecas de terceiros **embutidas por completo como
  texto** (não carregadas de CDN): `pdf.js` e seu worker, usados pra ler PDF de
  NFC-e 100% offline. Ver aviso importante sobre isso mais abaixo.

## ⚠️ Aviso operacional importante (evita um problema real que já aconteceu)

As bibliotecas `pdf.js` embutidas ficam em **uma única linha gigante cada**
(centenas de KB de JS minificado numa linha só). Rodar `grep -n` sem restringir
tamanho de linha nesse arquivo despeja megabytes de texto no contexto sem
querer. **Sempre** que for inspecionar ou editar o arquivo:

- Pra buscar algo, use `grep -oE` (só o trecho casado) ou filtre por tamanho de
  linha em Python antes de imprimir (`if len(line) < 300: print(...)`).
- Pra validar sintaxe JS, extraia só os blocos `<script>` **sem atributos**
  (os módulos próprios; os embutidos têm `id="pdfjsLibSource"` etc.) via
  `re.findall(r'<script>(.*?)</script>', html, re.DOTALL)` e rode
  `node --check` em cada um.
- Pra checar IDs duplicados: `grep -oE 'id="[a-zA-Z0-9_-]+"' arquivo | sort | uniq -c | sort -rn`.

## Chaves de storage usadas

- `cf-shopping-v1`, `cf-expenses-v1`, `cf-market-v1`, `cf-wishlist-v1` — dados atuais
  de cada módulo. Desejos: `{ items: [{ id, name, expectedPrice, note, links: [{ id, url, price, history: [{ id, t, price }] }] }] }`
  (`t` = timestamp do registro; `history` fica ordenado por `t` e `price` é **derivado**: o preço do
  último registro. `price` 0 / `history` vazio = link sem preço, ignorado na média e na queda de preço).
  Links no formato antigo (só `price`, sem `history`) são convertidos no carregamento — o `price` vira o
  primeiro registro — e o resultado é gravado na hora, para a data do registro não mudar a cada abertura.
- `cf-push-v1` — avisos por push: `{ url, enabled, lead, hour }` (endereço do Worker, ligado/desligado, dias de antecedência 0–7,
  hora do aviso). Não tem dado pessoal; a assinatura de push em si mora no navegador (`PushManager`), não no storage.
- Migração automática (uma vez só, na primeira carga de cada módulo se a chave
  nova estiver vazia): lista de compras busca em `lista-compras-v4`, despesas
  fixas busca em `despesas-fixas-v1` (chaves de apps standalone anteriores).
- O módulo de Mercado começa **vazio** quando não há nada salvo: nenhum dado pessoal
  vai embutido no código (o repositório é público). O histórico de compras entra
  pelo botão **"Importar dados (.json)"** na tela de Mercado, que aceita
  `{ "items": [...], "discounts": [...], "settings": { "monthlyGoal": null } }`
  (mesmo formato salvo em `cf-market-v1`). A importação mescla sem duplicar —
  importar o mesmo arquivo duas vezes não altera nada. Cada item tem `data`
  (AAAA-MM-DD), `loja`, `cidade`, `descricao`, `qtde`, `unidade`, `valorUnit`,
  `valorTotal`, `categoria`. Arquivos de dados pessoais ficam fora do repositório
  (`.gitignore` ignora `*.json` fora de `manifest.json`).

## Funcionalidades já implementadas (não reconstruir do zero)

- CRUD de categorias em Compras e Despesas (renomear, excluir com realocação).
- Drag-and-drop de item entre categorias (Compras e Despesas).
- Ordenação automática por dia de vencimento em Despesas (itens sem data mantêm
  ordem manual).
- Overdue (vencido, vermelho) e due-soon (vence em até 3 dias, amarelo) em
  Despesas, com card de resumo no topo quando há algo vencendo em breve.
- Editar e excluir uma compra inteira do histórico de Mercado (por data+loja).
- Importador de NFC-e: upload de PDF (lido via pdf.js embutido) ou colar texto
  copiado da página da Sefaz; extrai itens por regex (padrão
  `Qtde.: X UN Vl. Unit.: Y Vl. Total Z`); decodifica UF/data/CNPJ/número a
  partir da chave de acesso de 44 dígitos e valida o dígito verificador
  (algoritmo módulo 11) antes de confiar nos dados decodificados.
- Gráfico de evolução de preço de um produto específico ao longo do tempo
  (dentro de "Comparar preço de um item"), com pontos coloridos por loja.
- Estimativa de valor da Lista de Compras cruzando nome do item com o histórico
  de preços do Mercado (correspondência por substring, case/acento-insensitive;
  média ponderada pelo número de compras quando casa com mais de um produto).
- PWA completo: manifest com ícones normal + maskable, service worker
  (cache-first com atualização em segundo plano), meta tags específicas do
  iOS Safari (que ignora o manifest pra nome/ícone). Ao mudar `index.html` de
  forma relevante, incremente `CACHE_NAME` em `service-worker.js`.
- Redesign Nocturne (menu lateral com 6 destinos, sino de notificações, formulário
  de "Nova despesa" recolhível, KPIs do Mercado em grade 2×2, histórico de compras em
  cartões, diálogo de confirmação com botão vermelho só para ações destrutivas).
  O botão "Importar dados (.json)" usa o rótulo "Importar" em roxo, não "Excluir".
- **Virada do mês nas Despesas fixas** (automática): ao abrir o app (ou voltar do segundo plano) num mês novo, as contas
  **pagas** voltam a pendente e as **não pagas continuam**, acumulando `unpaidMonths` (1 = só o mês atual). Com 2 ou mais
  a linha mostra "Sem pagamento há N meses" e a conta conta como atrasada (não como "vencendo"). O usuário é avisado uma vez
  por um diálogo. O mês de referência fica em `cycle` (AAAA-MM) dentro de `cf-expenses-v1`; dados antigos, sem `cycle`, só
  registram o mês atual. Se o app ficar meses sem abrir, todos os meses decorridos contam como sem pagamento nas contas que
  estavam pendentes. "Reiniciar mês" e "Desmarcar tudo" (Compras) pedem confirmação.
- Acessibilidade: modais com `role="dialog"`/`aria-modal`, foco que entra ao abrir, Tab preso dentro e retorno do foco ao
  fechar; menu lateral fechado fora da ordem de Tab; Esc fecha o item do topo (diálogo > modais > menu > sino).
- **Avisos por push (Despesas → "Avisos por push")**: notificação no celular quando uma conta está perto de vencer, com o app
  fechado. Precisa de um **Worker do Cloudflare criado pelo usuário** (`push-worker/`, passo a passo em `push-worker/LEIA-ME.md`):
  o app (módulo `px-`) pede a permissão, cria a assinatura de push e manda ao Worker a lista de contas (nome, valor, dia, paga,
  `cycle`, fuso, hora, antecedência) a cada mudança (debounce de 1,5 s), ao abrir, ao voltar para o app e quando a internet volta
  (`CF.expenses.onChange` + `CF.expenses.snapshot`). O Worker roda de hora em hora (cron), avisa **uma vez por dia**, agrupado, depois
  da hora escolhida, cifra o payload (RFC 8291) e assina com VAPID (RFC 8292) só com WebCrypto. O `service-worker.js` trata `push`
  (sempre mostra uma notificação: iOS/Chrome punem push silencioso) e `notificationclick` (foca o app e manda `{cfOpenView}`; com o
  app fechado abre `#despesas`). No iPhone só funciona com o app instalado na tela inicial e iOS 16.4+.
  **A regra de "perto de vencer" existe em dois lugares:** `dueSoonDays` (app, sino) e `dueBills` (`push-worker/worker.mjs`, que
  também cobre a virada do mês com o app fechado e o vencimento logo após a virada). Ao mudar uma, mude a outra e os testes.

## Limitações conhecidas (decisões deliberadas, não bugs)

- Sem backend: tudo roda local no navegador (`localStorage`/`window.storage`).
  Nenhum dado é compartilhado entre dispositivos. **Única exceção, opcional:** se o usuário ativar os avisos por push, o nome, o valor
  e o dia de vencimento das contas vão para o Worker dele no Cloudflare (dito na tela e em `push-worker/LEIA-ME.md`).
- Push: o app **não** avisa nada sozinho com ele fechado (um PWA sem servidor não pode); sem o Worker só existe o sino dentro do app.
  Validado com um serviço de push real só no Edge/WNS (o código do Worker enviou teste e aviso agrupado e o navegador decifrou);
  Google/FCM, Apple/iPhone e a implantação no Cloudflare não foram testados aqui. O resto: criptografia/assinatura contra as RFCs e o
  fluxo do app com tudo simulado. O botão "Enviar aviso de teste" é como o usuário confere no aparelho dele.
- Duas compras no mesmo dia, na mesma loja, são tratadas como uma "ida ao
  mercado" só (agrupamento é por `data+loja`) — herdado do app original.
- A correspondência de preço da Lista de Compras é aproximada (substring), não
  usa nenhum tipo de matching semântico.
- O Comparador de Preços é uma calculadora avulsa — não salva nada e não usa o
  histórico do Mercado.
- O arquivo final pesa ~1.7MB por causa do pdf.js embutido. Only baixa mais
  devagar na primeira visita; depois disso o service worker cacheia.

## Sugestões discutidas com o usuário mas ainda NÃO implementadas

Se o usuário pedir para continuar dessas ideias (já validadas com ele antes):

- **Ler o QR Code da nota pela câmera** em vez de precisar do PDF/colar texto —
  daria pra usar a biblioteca `jsQR` (~40KB, leve o suficiente pra embutir igual
  o pdf.js), acessando a câmera via `getUserMedia`.
- **Exportar/importar backup dos dados** — hoje só existe a importação de dados
  do Mercado (ver "Chaves de storage"). Falta um botão que baixe um `.json` com
  tudo (compras, despesas, mercado) e a restauração dos três módulos. Foi
  oferecido ao usuário como proteção extra contra o iOS eventualmente limpar o
  `localStorage` de apps instalados na tela de início que ficam muito tempo sem
  uso; ele ainda não confirmou se quer.

## Fluxo de trabalho / como validar antes de entregar

1. Editar o `index.html` diretamente (é o único arquivo de código; os outros são
   estáticos: manifest, service worker, ícones).
2. Validar sintaxe: extrair os `<script>` sem atributos (ver aviso acima) e
   rodar `node --check` em cada um.
3. Checar IDs duplicados no HTML inteiro.
3b. Rodar `npm test` (ver `tests/e2e.js`; roda antes `tests/push-worker.test.mjs` e `tests/service-worker.test.mjs`, Node puro): verificações de ponta a ponta com dados fictícios, fuso
   America/Sao_Paulo e data fixa (inclui fuso à noite, arrastar e soltar, Esc nos modais e PWA offline). Ao mudar comportamento, acrescente o teste correspondente; e, para ter certeza de que
   um teste novo realmente pega o defeito, rode-o contra uma cópia quebrada com `TEST_INDEX=copia.html`.
   Observação: o GitHub Pages publica a raiz inteira, então `tests/` também vai ao ar (só tem dados fictícios).
4. Quando mexer em lógica de cálculo (preços, datas, parsing de NFC-e), testar
   com `node -e "..."` isolando só a função pura antes de aplicar no arquivo —
   esse projeto usou bastante esse padrão pra pegar bugs de matemática/parsing
   antes de entregar.
5. Publicação: o usuário hospeda no GitHub Pages. Se o Claude Code tiver acesso
   de escrita ao GitHub do usuário, o ideal é este pacote virar a raiz de um
   repositório novo (ex: `controle-financeiro`) com Pages ativado na branch
   `main`, pasta `/`. Depois de qualquer atualização, o app já instalado no
   celular do usuário atualiza sozinho (o service worker refaz o cache) —
   não precisa reinstalar nada.

## Contexto adicional relevante

- Categorias fixas do Mercado, sempre nesta ordem: Alimentação, Limpeza,
  Medicamentos, Higiene, Itens Domésticos.
- Preferências do usuário: workflows diretos e objetivos, pouca conversa de ida
  e volta, saída limpa sem texto de enquadramento desnecessário.
