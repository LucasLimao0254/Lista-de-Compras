# CLAUDE.md

Controle Financeiro: PWA de página única (HTML+CSS+JS puro, sem build, sem backend) com
lista de compras, despesas fixas, controle de mercado e comparador de preços.

Leia `HANDOFF.md` antes de mexer — ele descreve a arquitetura, as chaves de storage, o que já
está implementado e o fluxo de validação.

## Cuidado ao inspecionar `index.html`

O arquivo tem ~1.7MB porque o `pdf.js` e seu worker estão embutidos, **cada um em uma única
linha gigante**. Nunca rode `grep -n` / `Read` sem restringir: use `grep -oE` (só o trecho casado)
ou filtre linhas por tamanho. Os módulos próprios estão nos `<script>` sem atributos.

## Rodar localmente

O service worker exige HTTP (não funciona em `file://`):

```bash
npx serve .
```

## Validar antes de entregar

- Sintaxe: extrair os `<script>` sem atributos (`/<script>([\s\S]*?)<\/script>/g`) e rodar `node --check` em cada um.
- IDs duplicados: `grep -oE 'id="[a-zA-Z0-9_-]+"' index.html | sort | uniq -c | sort -rn`.
- Ao alterar `index.html` ou os assets, incrementar `CACHE_NAME` em `service-worker.js` se a lista de `ASSETS` mudar.
