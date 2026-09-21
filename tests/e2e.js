#!/usr/bin/env node
/*
 * Testes de ponta a ponta do Controle Financeiro — sem dependências (só Node >= 22 e um Chrome/Edge).
 *
 *   npm test                       (ou: node tests/e2e.js)
 *
 * Sobe um servidor estático local, abre o app num Chrome/Edge headless via DevTools Protocol, fixa o
 * fuso em America/Sao_Paulo e a data em 15/09/2026 12:00 (para "vence em breve" ser determinístico) e
 * semeia dados 100% FICTÍCIOS no localStorage. Nunca lê nem grava nada fora de um diretório temporário.
 *
 * Variáveis opcionais:
 *   CHROME_PATH   caminho do navegador (senão procura Edge/Chrome/Chromium nos lugares comuns)
 *   TEST_INDEX    usa outro HTML no lugar do index.html (serve para "testar o teste" com uma cópia quebrada)
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net');

const ROOT = path.resolve(__dirname, '..');
const INDEX = process.env.TEST_INDEX ? path.resolve(process.env.TEST_INDEX) : path.join(ROOT, 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();   // NBSP do toLocaleString vira espaço comum

/* ------------------------------------------------------------------ navegador */
function findBrowser() {
  const candidates = [process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return candidates.find(p => p && fs.existsSync(p));
}
function freePort() { return new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }

/* ------------------------------------------------------------------ servidor estático */
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png' };
function startServer() {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const file = (u === '/' || u === '/index.html') ? INDEX : path.join(ROOT, u);
    if (!file.startsWith(ROOT) && file !== INDEX) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, b) => {
      if (e) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(b);
    });
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port })));
}

/* ------------------------------------------------------------------ dados fictícios (data fixa: 15/09/2026) */
const DEFAULT_NOW = '2026-09-15T15:00:00Z';   // 12:00 em São Paulo
const dateMock = iso => `(function(){var R=Date,f=new R('${iso}').getTime();
  function M(a,b,c,d,e,g,h){ if(!(this instanceof M)) return new R(f).toString(); var n=arguments.length;
    return n===0?new R(f):n===1?new R(a):n===2?new R(a,b):n===3?new R(a,b,c):n===4?new R(a,b,c,d):n===5?new R(a,b,c,d,e):n===6?new R(a,b,c,d,e,g):new R(a,b,c,d,e,g,h); }
  M.prototype=R.prototype; M.now=function(){return f}; M.parse=R.parse; M.UTC=R.UTC; window.Date=M; window.__setNow=function(iso){ f=new R(iso).getTime(); }; })();`;
const SEED = `(function(){
  if (localStorage.getItem('cf-market-v1')) return;
  var it = function(d,l,desc,q,u,vu,cat){ return {data:d,loja:l,cidade:'Cidade Exemplo',descricao:desc,qtde:q,unidade:'UN',valorUnit:vu,valorTotal:Math.round(q*vu*100)/100,categoria:cat}; };
  localStorage.setItem('cf-market-v1', JSON.stringify({ items:[
    it('2026-09-03','Supermercado Exemplo','ARROZ TIPO 1 5KG',1,'UN',27.9,'Alimentação'), it('2026-09-03','Supermercado Exemplo','FEIJAO CARIOCA 1KG',2,'UN',7.8,'Alimentação'), it('2026-09-03','Supermercado Exemplo','LEITE INTEGRAL 1L',3,'UN',5.1,'Alimentação'),
    it('2026-09-10','Atacado Demo','CAFE TORRADO 500G',1,'UN',18.5,'Alimentação'), it('2026-09-10','Atacado Demo','DETERGENTE LIQUIDO 500ML',4,'UN',2.9,'Limpeza'),
    it('2026-08-20','Supermercado Exemplo','ARROZ TIPO 1 5KG',1,'UN',29.9,'Alimentação') ], discounts:[], settings:{monthlyGoal:1200} }));
  localStorage.setItem('cf-shopping-v1', JSON.stringify({ categories:['Alimentos','Limpeza'], items:[
    {id:'s1',name:'Arroz 5kg',category:'Alimentos',checked:false,order:0}, {id:'s2',name:'Feijão',category:'Alimentos',checked:false,order:1}, {id:'s3',name:'Café',category:'Alimentos',checked:true,order:2},
    {id:'s4',name:'Detergente',category:'Limpeza',checked:false,order:0}, {id:'s5',name:'Sabão em pó',category:'Limpeza',checked:true,order:1} ] }));
  var ex = function(id,n,a,d,c,p){ return {id:id,name:n,amount:a,dueDay:d,notes:'',category:c,paid:p,order:0}; };
  localStorage.setItem('cf-expenses-v1', JSON.stringify({ categories:['Moradia','Contas','Outros'], items:[
    ex('e1','Aluguel',1200,5,'Moradia',true), ex('e2','Condomínio',350,10,'Moradia',false), ex('e3','Plano de saúde',480,12,'Outros',true), ex('e4','Energia elétrica',240,13,'Contas',false),
    ex('e5','Curso de inglês',260,14,'Outros',true), ex('e6','Internet',119.9,16,'Contas',false), ex('e7','Água e esgoto',95,17,'Contas',false), ex('e8','Streaming',39.9,18,'Outros',false), ex('e9','Seguro do carro',210,28,'Outros',false) ] }));
  localStorage.setItem('cf-wishlist-v1', JSON.stringify({ items:[
    {id:'w1',name:'Air fryer',expectedPrice:349.9,note:'',links:[{id:'l1',url:'https://exemplo.com/a',price:329.9},{id:'l2',url:'https://exemplo.com/b',price:369.9}]},
    {id:'w2',name:'Liquidificador',expectedPrice:189.9,note:'',links:[]} ] }));
})();`;

/* ------------------------------------------------------------------ cliente DevTools */
async function launch(port) {
  const exe = findBrowser();
  if (!exe) { console.error('Nenhum Chrome/Edge/Chromium encontrado. Defina CHROME_PATH.'); process.exit(2); }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-e2e-'));
  const args = ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', 'about:blank'];
  if (process.platform === 'linux' || process.env.CI) args.unshift('--no-sandbox');
  const proc = spawn(exe, args, { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (list.some(t => t.type === 'page')) break; } catch (e) {} await sleep(250); }
  if (!list) throw new Error('o navegador não respondeu no DevTools Protocol');
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  return { proc, profile, ws };
}

(async () => {
  const { server, port: appPort } = await startServer();
  const dtPort = await freePort();
  const { proc, profile, ws } = await launch(dtPort);
  const BASE = 'http://127.0.0.1:' + appPort + '/';

  let id = 0; const pending = new Map(); const errors = []; const externalRequests = []; let loadWaiter = null;
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.loadEventFired' && loadWaiter) loadWaiter();
    if (m.method === 'Runtime.exceptionThrown') errors.push('exceção: ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + (m.params.args || []).map(x => x.value || x.description).join(' '));
    if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('about:') && !u.startsWith('blob:')) externalRequests.push(u); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout de ' + ms + 'ms ' + what)), ms))]);
  const ev = async (body) => {
    const r = await withTimeout(send('Runtime.evaluate', { expression: '(async()=>{' + body + '})()', awaitPromise: true, returnByValue: true }), 15000, 'executando código na página (uma Promise nunca resolveu?)');
    if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description || 'erro no navegador');
    return r.result.result.value;
  };
  const waitFor = async (cond, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev('return !!(' + cond + ')')) return true; } catch (e) {} await sleep(80); } throw new Error('timeout esperando: ' + cond); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  let scriptIds = [];
  async function openPage({ seed = true, width = 390, height = 844, now = DEFAULT_NOW, tz = 'America/Sao_Paulo' } = {}) {
    for (const s of scriptIds) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: s });
    scriptIds = [];
    await send('Storage.clearDataForOrigin', { origin: BASE.replace(/\/$/, ''), storageTypes: 'all' });
    await send('Emulation.setTimezoneOverride', { timezoneId: tz });
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 700, maxTouchPoints: 5 });
    scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: dateMock(now) })).result.identifier);
    if (seed) scriptIds.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED })).result.identifier);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    await reload(true);
  }
  async function reload(navigate) {
    const loaded = new Promise(r => loadWaiter = r);
    await send(navigate ? 'Page.navigate' : 'Page.reload', navigate ? { url: BASE } : {});
    await loaded;
    await waitFor("window.CF && window.CF.refreshAlerts && window.CF.wishlist && window.CF.wishlist.priceDrops");
    await sleep(350);
  }
  const goto = view => ev(`document.querySelector('[data-view="${view}"]').click(); await new Promise(r=>setTimeout(r,150)); return document.getElementById('pageTitle').textContent;`);

  /* ---------------------------------------------------------------- runner */
  let pass = 0, fail = 0; const failures = [];
  async function test(name, fn) {
    try { await fn(); pass++; console.log('  ok     ' + name); }
    catch (e) { fail++; failures.push(name); console.log('  FALHA  ' + name + '\n         ' + String(e.message).split('\n')[0]); }
  }
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((what || 'valor') + ': esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); };
  const ok = (cond, what) => { if (!cond) throw new Error(what || 'condição falsa'); };
  const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) throw new Error((what || 'valor') + ': esperado ~' + b + ', veio ' + a); };
  const group = t => console.log('\n' + t);

  /* ================================================================ 1. Visão geral e sino */
  group('Visão geral e sino de notificações');
  await openPage();
  await test('total desembolsado = contas pagas (R$ 1.940,00) + mercado do mês (R$ 88,90)', async () => {
    eq(norm(await ev(`return document.getElementById('ovDisbursedMonth').textContent`)), 'R$ 2.028,90');
  });
  await test('barra segmentada soma 100% e respeita as proporções', async () => {
    const w = await ev(`return ['ovBarPaid','ovBarMarket','ovBarPending'].map(i=>parseFloat(document.getElementById(i).style.width))`);
    near(w[0] + w[1] + w[2], 100, 0.01, 'soma');
    near(w[0], 1940 / 3083.7 * 100, 0.05, 'pago'); near(w[1], 88.9 / 3083.7 * 100, 0.05, 'mercado'); near(w[2], 1054.8 / 3083.7 * 100, 0.05, 'pendente');
  });
  await test('cartões-resumo com os números certos (despesas, desejos, compras, mercado)', async () => {
    const r = await ev(`const t=id=>document.getElementById(id).textContent; return [t('ovExpensesTotal'),t('ovExpensesPaid'),t('ovExpensesPending'),t('ovWishCount'),t('ovWishDrops'),t('ovShoppingPending'),t('ovShoppingTotal'),t('ovMarketMonth'),t('ovMarketTrips')]`);
    eq(r.map(norm), ['R$ 2.994,80', 'R$ 1.940,00', 'R$ 1.054,80', '2', '1', '3', '5', 'R$ 88,90', '2']);
  });
  await test('subtítulo da Visão geral fica vazio (sem linha em branco)', async () => {
    eq(await ev(`const p=document.getElementById('pageSub'); return [p.textContent, getComputedStyle(p).display]`), ['', 'none']);
  });
  await test('sino aparece com 2 alertas: 3 contas vencendo (R$ 254,80) e 1 queda de preço (R$ 20,00)', async () => {
    const r = await ev(`return { has: document.getElementById('notifBtn').classList.contains('has-alerts'), texts: [...document.querySelectorAll('#notifPanel .alert')].map(a=>a.textContent) }`);
    ok(r.has, 'sino deveria estar visível'); eq(r.texts.length, 2, 'alertas');
    ok(/3 contas vencendo/.test(norm(r.texts[0])) && /R\$ 254,80/.test(norm(r.texts[0])), 'alerta de contas: ' + norm(r.texts[0]));
    ok(/1 item da lista de desejos caiu/.test(norm(r.texts[1])) && /R\$ 20,00 em Air fryer/.test(norm(r.texts[1])), 'alerta de desejos: ' + norm(r.texts[1]));
  });
  await test('sino abre no clique, fecha com Esc e ao clicar fora', async () => {
    const r = await ev(`const p=document.getElementById('notifPanel'), b=document.getElementById('notifBtn'); const st=[];
      b.click(); st.push(p.classList.contains('open')); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); st.push(p.classList.contains('open'));
      b.click(); st.push(p.classList.contains('open')); document.body.click(); st.push(p.classList.contains('open')); return st`);
    eq(r, [true, false, true, false]);
  });
  await test('menu lateral tem 6 destinos, abre e fecha pelo fundo, e cada um troca de tela/título', async () => {
    eq(await ev(`return document.querySelectorAll('#drawer .drawer-item').length`), 6);
    eq(await ev(`document.getElementById('menuBtn').click(); const a=document.getElementById('drawer').classList.contains('open'); document.getElementById('drawerOverlay').click(); return [a, document.getElementById('drawer').classList.contains('open')]`), [true, false]);
    const titles = []; for (const v of ['compras', 'despesas', 'mercado', 'comparador', 'desejos', 'overview']) titles.push(await goto(v));
    eq(titles, ['Lista de compras', 'Despesas fixas', 'Controle de mercado', 'Comparador de preços', 'Lista de desejos', 'Visão geral']);
  });

  /* ================================================================ 2. Despesas fixas */
  group('Despesas fixas');
  await test('vencidas (2) e vencendo em até 3 dias (3) são marcadas; alerta de R$ 254,80 sem emoji', async () => {
    await goto('despesas');
    const r = await ev(`return { overdue: document.querySelectorAll('#ex-sections li.overdue').length, soon: document.querySelectorAll('#ex-sections li.due-soon').length, card: document.getElementById('ex-dueSoonLabel').textContent, disp: getComputedStyle(document.getElementById('ex-dueSoonCard')).display }`);
    eq([r.overdue, r.soon, r.disp], [2, 3, 'flex']);
    ok(/3 contas vencendo/.test(norm(r.card)) && /R\$ 254,80/.test(norm(r.card)), 'texto do alerta: ' + norm(r.card)); ok(!r.card.includes('⚠'), 'não deve ter o emoji');
  });
  await test('formulário "Nova despesa" começa recolhido, abre/fecha pelo botão e troca o rótulo', async () => {
    const r = await ev(`const p=document.getElementById('ex-addPanel'), b=document.getElementById('ex-newToggle'); const vis=()=>getComputedStyle(p).display!=='none'; const out=[vis()];
      b.click(); out.push(vis(), b.textContent, b.getAttribute('aria-expanded')); b.click(); out.push(vis(), b.textContent); return out`);
    eq(r, [false, true, 'Fechar formulário', 'true', false, '+ Nova despesa']);
  });
  await test('adicionar despesa salva valor (89,90) e dia (25) e persiste', async () => {
    await ev(`document.getElementById('ex-newToggle').click(); document.getElementById('ex-newNameInput').value='Academia'; document.getElementById('ex-newAmountInput').value='89,90'; document.getElementById('ex-newDayInput').value='25'; document.getElementById('ex-addBtn').click(); await new Promise(r=>setTimeout(r,250));`);
    const s = await ev(`const i=JSON.parse(localStorage.getItem('cf-expenses-v1')).items.find(x=>x.name==='Academia'); return i && [i.amount, i.dueDay, i.paid]`);
    eq(s, [89.9, 25, false]);
  });
  await test('marcar uma conta vencendo como paga reduz o alerta e o sino na hora', async () => {
    const r = await ev(`const before=window.CF.expenses.dueSoon(); document.querySelector('#ex-sections li.due-soon .box').click(); await new Promise(r=>setTimeout(r,250));
      const after=window.CF.expenses.dueSoon(); return { before, after, bell: document.getElementById('notifPanel').innerText, card: document.getElementById('ex-dueSoonLabel').textContent }`);
    eq([r.before.count, r.after.count], [3, 2]);
    ok(new RegExp(r.after.count + ' contas vencendo').test(norm(r.bell)) && new RegExp(r.after.count + ' contas vencendo').test(norm(r.card)), 'sino/cartão não atualizaram');
  });

  /* ================================================================ 3. Lista de desejos */
  group('Lista de desejos');
  await openPage();
  await test('formulário recolhido; nome vazio não cria item e avisa', async () => {
    await goto('desejos');
    eq(await ev(`return getComputedStyle(document.getElementById('wl-form')).display`), 'none');
    const r = await ev(`document.getElementById('wl-toggleForm').click(); document.getElementById('wl-name').value='   '; document.getElementById('wl-submit').click(); await new Promise(r=>setTimeout(r,200)); return [JSON.parse(localStorage.getItem('cf-wishlist-v1')).items.length, document.getElementById('wl-status').textContent]`);
    eq(r[0], 2); ok(/descrição/i.test(r[1]), 'mensagem de status: ' + r[1]);
  });
  await test('valores esperados são lidos em "349,90", "1.299,90", "R$ 349,90" e "349.90"', async () => {
    const r = await ev(`const cases=[['A','349,90'],['B','1.299,90'],['C','R$ 349,90'],['D','349.90']];
      for (const [n,p] of cases){ const f=document.getElementById('wl-form'); if(getComputedStyle(f).display==='none') document.getElementById('wl-toggleForm').click(); document.getElementById('wl-name').value=n; document.getElementById('wl-price').value=p; document.getElementById('wl-submit').click(); await new Promise(r=>setTimeout(r,150)); }
      const items=JSON.parse(localStorage.getItem('cf-wishlist-v1')).items; return ['A','B','C','D'].map(n=>items.find(i=>i.name===n).expectedPrice)`);
    eq(r, [349.9, 1299.9, 349.9, 349.9]);
  });
  await test('link https vira <a target=_blank rel=noopener>; "javascript:" fica só como texto', async () => {
    const r = await ev(`document.getElementById('wl-toggleForm').click(); document.getElementById('wl-name').value='Monitor'; document.getElementById('wl-price').value='1299,90'; document.getElementById('wl-addLinkField').click();
      const ins=document.querySelectorAll('#wl-linkFields input'); ins[0].value='https://loja.exemplo/monitor'; ins[0].dispatchEvent(new Event('input',{bubbles:true})); ins[2].value='javascript:alert(1)'; ins[2].dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('wl-submit').click(); await new Promise(r=>setTimeout(r,200));
      const card=[...document.querySelectorAll('#wl-list .wl-item')].find(c=>c.textContent.includes('Monitor')); card.querySelector('.wl-toggle-links').click(); await new Promise(r=>setTimeout(r,150));
      const c2=[...document.querySelectorAll('#wl-list .wl-item')].find(c=>c.textContent.includes('Monitor'));
      return { anchors:[...c2.querySelectorAll('.wl-link a')].map(a=>[a.getAttribute('href'),a.target,a.rel]), spans:[...c2.querySelectorAll('.wl-link > span')].map(s=>s.textContent), anyJsHref: !!document.querySelector('a[href^="javascript"]') }`);
    eq(r.anchors.length, 1); ok(r.anchors[0][0].startsWith('https://') && r.anchors[0][1] === '_blank' && /noopener/.test(r.anchors[0][2]), 'atributos do link: ' + JSON.stringify(r.anchors[0]));
    eq(r.spans, ['javascript:alert(1)']); ok(!r.anyJsHref, 'existe <a href="javascript:…"> na página');
  });
  await test('preço de um link abaixo do esperado vira queda de preço e atualiza o sino', async () => {
    const r = await ev(`const before=window.CF.wishlist.priceDrops().count; const c=[...document.querySelectorAll('#wl-list .wl-item')].find(c=>c.textContent.includes('Monitor'));
      const b=c.querySelectorAll('.wl-link-block')[0]; const ins=b.querySelectorAll('.wl-reg input'); ins[0].value='1.199,00'; b.querySelector('.wl-reg button').click(); await new Promise(r=>setTimeout(r,250));
      return { before, after: window.CF.wishlist.priceDrops(), bell: document.getElementById('notifPanel').innerText, stored: JSON.parse(localStorage.getItem('cf-wishlist-v1')).items.find(i=>i.name==='Monitor').links[0].price }`);
    eq([r.before, r.after.count, r.stored], [1, 2, 1199]); near(r.after.total, 20 + 100.9, 0.001, 'economia total');
    ok(/2 itens da lista de desejos caíram de preço/.test(norm(r.bell)), 'texto do sino: ' + norm(r.bell));
  });
  await test('os dados sobrevivem a um recarregamento da página', async () => {
    await reload(false); await goto('desejos');
    const r = await ev(`return [document.querySelectorAll('#wl-list .wl-item').length, [...document.querySelectorAll('#wl-list .wl-item-name')].some(n=>n.textContent==='Monitor')]`);
    eq(r, [7, true]);
  });
  await test('excluir pede confirmação (botão vermelho); cancelar mantém, confirmar remove', async () => {
    const r = await ev(`const card=()=>[...document.querySelectorAll('#wl-list .wl-item')].find(c=>c.textContent.includes('Monitor'));
      card().querySelector('.icon-btn').click(); await new Promise(r=>setTimeout(r,150)); const cls=document.getElementById('app-dialog-ok').className, msg=document.getElementById('app-dialog-message').textContent;
      document.getElementById('app-dialog-cancel').click(); await new Promise(r=>setTimeout(r,150)); const kept=JSON.parse(localStorage.getItem('cf-wishlist-v1')).items.length;
      card().querySelector('.icon-btn').click(); await new Promise(r=>setTimeout(r,150)); document.getElementById('app-dialog-ok').click(); await new Promise(r=>setTimeout(r,250));
      return { cls, msg, kept, after: JSON.parse(localStorage.getItem('cf-wishlist-v1')).items.length }`);
    ok(/btn-danger/.test(r.cls), 'botão deveria ser vermelho'); ok(/Excluir "Monitor"/.test(r.msg), 'mensagem: ' + r.msg); eq([r.kept, r.after], [7, 6]);
  });

  /* ================================================================ 4. Controle de mercado */
  group('Controle de mercado');
  await openPage();
  await test('KPIs corretos (total, idas, ticket, categoria com mais gasto)', async () => {
    await goto('mercado');
    const r = await ev(`const t=id=>document.getElementById(id).textContent; return [t('mk-kpiTotal'),t('mk-kpiTrips'),t('mk-kpiTicket'),t('mk-kpiTopCat'), document.querySelector('.kpi .label').textContent, [...document.querySelectorAll('.kpi .label')].map(l=>l.textContent)[3]]`);
    eq(norm(r[0]), 'R$ 118,80'); eq(r[1], '3'); eq(norm(r[2]), 'R$ 39,60'); eq(r[3], 'Alimentação'); eq(r[5], 'Categoria com mais gasto');
  });
  await test('topo: NFC-e e Importar .json lado a lado; "+ Adicionar compra" em largura total abaixo', async () => {
    const r = await ev(`const R=id=>document.getElementById(id).getBoundingClientRect(); const a=R('mk-nfceBtn'), b=R('mk-importBtn'), c=R('mk-addBtn'), col=document.querySelector('.mk-topline').getBoundingClientRect(); return {a:[a.top,a.left,a.width],b:[b.top,b.left,b.width],c:[c.top,c.width],col:col.width}`);
    near(r.a[0], r.b[0], 1, 'mesma linha'); ok(r.b[1] > r.a[1], 'ordem'); ok(r.c[0] > r.a[0] + 20, 'add abaixo'); near(r.c[1], r.col, 2, 'largura total');
  });
  await test('KPIs em grade 2×2 com cartões da mesma altura e topo alinhado', async () => {
    const r = await ev(`return [...document.querySelectorAll('.kpi')].map(k=>{const b=k.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]})`);
    eq(r.length, 4); eq(r[0][0], r[1][0], 'topo da 1ª linha'); eq(r[2][0], r[3][0], 'topo da 2ª linha'); eq(r[0][1], r[1][1], 'altura da 1ª linha'); eq(r[2][1], r[3][1], 'altura da 2ª linha');
  });
  await test('valores da legenda e totais do histórico não quebram em duas linhas', async () => {
    const r = await ev(`const lines=s=>[...document.querySelectorAll(s)].map(e=>{const r=document.createRange(); r.selectNodeContents(e); return r.getClientRects().length}); return { legend:lines('#mk-donutLegend .legend-item b'), totals:lines('.grp-total') }`);
    ok(r.legend.length >= 3 && r.totals.length === 3, 'elementos não encontrados: ' + JSON.stringify(r));
    ok(r.legend.every(x => x === 1) && r.totals.every(x => x === 1), 'algum valor quebrou de linha (linhas de texto por valor): ' + JSON.stringify(r));
  });
  await test('campo "Compare o preço de um item" usa o estilo do tema (fundo escuro, borda do tema)', async () => {
    const r = await ev(`const s=getComputedStyle(document.getElementById('mk-pcSearch')); return [s.backgroundColor, s.borderTopWidth]`);
    eq(r, ['rgb(35, 37, 50)', '1px']);
  });
  await test('importar .json: confirma com botão roxo "Importar", adiciona 1 item e reimportar não duplica', async () => {
    const r = await ev(`const file=()=>{const dt=new DataTransfer(); dt.items.add(new File([JSON.stringify({items:[{data:'2026-09-05',loja:'Loja Teste',descricao:'ITEM X',qtde:2,valorUnit:3}]})],'x.json')); const i=document.getElementById('mk-importFile'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true}));};
      file(); await new Promise(r=>setTimeout(r,250)); const ok1=document.getElementById('app-dialog-ok'); const first=[ok1.textContent, ok1.className]; ok1.click(); await new Promise(r=>setTimeout(r,250)); document.getElementById('app-dialog-ok').click(); await new Promise(r=>setTimeout(r,150));
      file(); await new Promise(r=>setTimeout(r,250)); const second=document.getElementById('app-dialog-message').textContent; document.getElementById('app-dialog-ok').click(); await new Promise(r=>setTimeout(r,150));
      return { first, second, n: JSON.parse(localStorage.getItem('cf-market-v1')).items.filter(i=>i.descricao==='ITEM X').length }`);
    eq(r.first[0], 'Importar'); ok(/btn-primary/.test(r.first[1]) && !/danger/.test(r.first[1]), 'estilo do botão'); ok(/Nada a importar/.test(r.second), 'segunda importação: ' + r.second); eq(r.n, 1);
  });
  await test('modal "Adicionar compra": item em cartão, × ao lado do nome, categoria em linha inteira', async () => {
    const r = await ev(`document.getElementById('mk-addBtn').click(); await new Promise(r=>setTimeout(r,200)); const row=document.querySelector('.mk-item-row'); const R=s=>row.querySelector(s).getBoundingClientRect(); const rw=row.getBoundingClientRect().width;
      return { open: document.getElementById('mk-overlay').classList.contains('open'), catW: R('.mk-cat').width/rw, rmTop: R('.rm').top, descTop: R('.mk-desc').top, descBottom: R('.mk-desc').bottom, qtyTop: R('.mk-qtd').top }`);
    ok(r.open, 'modal não abriu'); ok(r.catW > 0.85, 'categoria deveria ocupar a linha (' + r.catW.toFixed(2) + ')'); ok(r.rmTop >= r.descTop - 2 && r.rmTop <= r.descBottom, '× fora da linha do nome'); ok(r.qtyTop > r.descBottom, 'campos abaixo do nome');
    await ev(`document.getElementById('mk-cancelBtn').click()`);
  });
  await test('NFC-e: botão de PDF do tema mostra o nome do arquivo escolhido', async () => {
    const r = await ev(`document.getElementById('mk-nfceBtn').click(); await new Promise(r=>setTimeout(r,200)); const dt=new DataTransfer(); dt.items.add(new File(['%PDF-1.4'],'nota-teste.pdf',{type:'application/pdf'})); const i=document.getElementById('mk-nfcePdfInput'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,250));
      return { label: document.getElementById('mk-nfcePdfLabel').textContent, cls: i.parentElement.className, ph: document.getElementById('mk-nfceInput').placeholder }`);
    eq(r.label, 'nota-teste.pdf'); ok(/btn/.test(r.cls), 'não é o botão do tema'); ok(r.ph.length < 45, 'placeholder longo demais (corta no celular): ' + r.ph);
    await ev(`document.getElementById('mk-nfceCancelBtn').click()`);
  });
  await test('histórico: cada ida ao mercado é um cartão com data · loja, cidade · itens e total', async () => {
    const r = await ev(`const g=document.querySelector('details.grp'); return [g.querySelector('.grp-title').textContent, g.querySelector('.grp-sub').textContent, g.querySelector('.grp-total').textContent]`);
    ok(/^\d{2}\/\d{2} · /.test(r[0]) && /Cidade Exemplo · \d+ iten/.test(r[1]) && /^R\$/.test(norm(r[2])), JSON.stringify(r));
  });

  /* ================================================================ 5. Comparador */
  group('Comparador de preços');
  await test('cartões separados; resultado ordenado com "Melhor custo" primeiro e % mais caro', async () => {
    await goto('comparador');
    const r = await ev(`const add=document.getElementById('cp-addRowBtn'); while(document.querySelectorAll('.cp-row').length<3) add.click(); const set=(row,n,p,q)=>{const f=(s,v)=>{const e=row.querySelector(s); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}; f('.cp-name',n); f('.cp-price',p); f('.cp-qty',q); const u=row.querySelector('.cp-unit'); u.value='L'; u.dispatchEvent(new Event('change',{bubbles:true}));};
      const rows=[...document.querySelectorAll('.cp-row')]; set(rows[0],'Refri 2L',7.9,2); set(rows[1],'Refri 600ml',4.2,0.6); set(rows[2],'Refri 3L',10.5,3); await new Promise(r=>setTimeout(r,200));
      const rects=rows.map(r=>r.getBoundingClientRect()); const cards=[...document.querySelectorAll('.cp-result-card')];
      return { gap: rects[1].top-rects[0].bottom, order: cards.map(c=>c.querySelector('.cp-result-name').childNodes[0].textContent.trim()), best: cards[0].classList.contains('best'), badge: cards[0].textContent.includes('Melhor custo'), diff: cards[1].querySelector('.cp-result-diff').textContent }`);
    ok(r.gap >= 10, 'sem espaço entre cartões: ' + r.gap); eq(r.order, ['Refri 3L', 'Refri 2L', 'Refri 600ml']); ok(r.best && r.badge, 'destaque do melhor custo'); eq(r.diff, '+13% mais caro');
  });

  /* ================================================================ 6. Estado vazio */
  group('Primeiro uso (sem nenhum dado)');
  await openPage({ seed: false });
  await test('todas as telas abrem vazias, sem alerta e sem erro', async () => {
    eq(norm(await ev(`return document.getElementById('ovDisbursedMonth').textContent`)), 'R$ 0,00');
    eq(await ev(`return document.getElementById('notifBtn').classList.contains('has-alerts')`), false);
    await goto('mercado'); eq(norm(await ev(`return document.getElementById('mk-groups').textContent`)), 'Nenhuma compra encontrada com os filtros atuais.');
    await goto('desejos'); eq(await ev(`return getComputedStyle(document.getElementById('wl-empty')).display`), 'block');
    await goto('despesas'); eq(await ev(`return getComputedStyle(document.getElementById('ex-emptyState')).display`), 'block');
  });
  await test('o mercado não traz nenhum dado embutido (repositório público)', async () => {
    eq(await ev(`return localStorage.getItem('cf-market-v1')`), null);
  });

  /* ================================================================ 7. Layout responsivo, tema e offline */
  group('Layout, tema e offline');
  await openPage();
  await test('nenhuma tela tem rolagem horizontal no celular (390 px)', async () => {
    const bad = [];
    for (const v of ['overview', 'compras', 'despesas', 'mercado', 'comparador', 'desejos']) { await goto(v); const w = await ev(`return [document.documentElement.scrollWidth, window.innerWidth]`); if (w[0] > w[1]) bad.push(v + ' ' + w[0] + '>' + w[1]); }
    eq(bad, []);
  });
  await test('tokens que o JS lê existem (--s1…--s8, --danger, --warning, --good, --accent, --text-muted, --grid…)', async () => {
    const missing = await ev(`const cs=getComputedStyle(document.documentElement); return ['--s1','--s2','--s3','--s4','--s5','--s6','--s7','--s8','--danger','--warning','--good','--accent','--text-primary','--text-muted','--grid','--baseline','--surface-1','--bg','--panel','--line'].filter(v=>!cs.getPropertyValue(v).trim())`);
    eq(missing, []);
  });
  await test('a fonte Inter embutida carrega (sem depender da internet)', async () => {
    await ev(`await document.fonts.load('500 16px Inter')`);
    eq(await ev(`return document.fonts.check('500 16px Inter')`), true);
    eq(await ev(`return [...document.fonts].filter(f=>f.family.replace(/"/g,'')==='Inter'&&f.status==='loaded').length > 0`), true);
  });
  await test('em tela larga (1280 px) o app vira uma coluna central de até 720 px com título maior', async () => {
    await openPage({ width: 1280, height: 900 });
    const r = await ev(`const s=document.querySelector('.app-shell').getBoundingClientRect(); return [Math.round(s.width), Math.round(s.left), parseFloat(getComputedStyle(document.querySelector('.topbar-title h1')).fontSize)]`);
    ok(r[0] <= 720 && r[1] > 100, 'coluna: ' + JSON.stringify(r)); eq(r[2], 30);
  });
  await test('nenhum recurso externo foi requisitado (app 100% offline)', async () => { eq(externalRequests, []); });

  /* ================================================================ 8. Regressões: bugs achados na revisão */
  group('Regressões: bugs achados na revisão de código');

  await test('fuso: às 23:30 de 30/09 em Brasília, a data da compra e o "mês atual" ainda são setembro', async () => {
    await openPage({ now: '2026-10-01T02:30:00Z' });          // 23:30 locais de 30/09 (= 02:30 UTC de 01/10)
    await goto('mercado');
    const r = await ev(`document.getElementById('mk-addBtn').click(); await new Promise(r=>setTimeout(r,150)); const d=document.getElementById('mk-fData').value; document.getElementById('mk-cancelBtn').click();
      return { d: d, goal: document.getElementById('mk-goalCard').innerText, gasto: window.CF.market.summary().monthSpend }`);
    eq(r.d, '2026-09-30', 'data padrão da compra'); ok(/Setembro de 2026/.test(norm(r.goal)), 'mês da meta: ' + norm(r.goal).slice(0, 60)); eq(r.gasto, 88.9, 'gasto do mês');
  });

  await test('despesas: valor inválido ou nome repetido NÃO apagam o que foi digitado; só o sucesso limpa', async () => {
    await openPage(); await goto('despesas');
    const r = await ev(`const q=id=>document.getElementById(id); const st=()=>q('ex-status').textContent; const wait=()=>new Promise(r=>setTimeout(r,220)); q('ex-newToggle').click();
      q('ex-newNameInput').value='Academia'; q('ex-newAmountInput').value='abc'; q('ex-newDayInput').value='25'; q('ex-addBtn').click(); await wait();
      const invalido={n:q('ex-newNameInput').value,a:q('ex-newAmountInput').value,d:q('ex-newDayInput').value,s:st()};
      q('ex-newNameInput').value='Aluguel'; q('ex-newAmountInput').value='100'; q('ex-addBtn').click(); await wait();
      const repetido={n:q('ex-newNameInput').value,a:q('ex-newAmountInput').value,s:st()};
      q('ex-newNameInput').value='Academia'; q('ex-newAmountInput').value='89,90'; q('ex-addBtn').click(); await wait();
      return { invalido, repetido, sucesso:{n:q('ex-newNameInput').value,a:q('ex-newAmountInput').value,d:q('ex-newDayInput').value} }`);
    eq([r.invalido.n, r.invalido.a, r.invalido.d], ['Academia', 'abc', '25'], 'após valor inválido'); ok(/valor válido/.test(r.invalido.s), 'aviso: ' + r.invalido.s);
    eq([r.repetido.n, r.repetido.a], ['Aluguel', '100'], 'após nome repetido'); ok(/já está/.test(r.repetido.s), 'aviso: ' + r.repetido.s);
    eq([r.sucesso.n, r.sucesso.a, r.sucesso.d], ['', '', ''], 'após sucesso');
  });

  await test('desejos: "1.299" e "2.500" (ponto de milhar, sem vírgula) valem 1299 e 2500, como nas despesas', async () => {
    await openPage(); await goto('desejos');
    const r = await ev(`for (const [n,p] of [['E','1.299'],['F','2.500'],['G','349.90'],['H','12.5']]) { if(getComputedStyle(document.getElementById('wl-form')).display==='none') document.getElementById('wl-toggleForm').click(); document.getElementById('wl-name').value=n; document.getElementById('wl-price').value=p; document.getElementById('wl-submit').click(); await new Promise(r=>setTimeout(r,140)); }
      const it=JSON.parse(localStorage.getItem('cf-wishlist-v1')).items; return ['E','F','G','H'].map(n=>it.find(i=>i.name===n).expectedPrice)`);
    eq(r, [1299, 2500, 349.9, 12.5]);
  });

  await test('celular: campos de texto com pelo menos 16px (abaixo disso o iPhone dá zoom ao tocar)', async () => {
    await openPage();
    const r = await ev(`const ids=['ex-newNameInput','sc-newItemInput','mk-searchBox','wl-name','mk-fLoja','mk-pcSearch','mk-storeFilter']; return { coarse: matchMedia('(pointer: coarse)').matches, sizes: ids.map(i=>[i, parseFloat(getComputedStyle(document.getElementById(i)).fontSize)]) }`);
    ok(r.coarse, 'a emulação de toque não ativou (pointer: coarse)');
    const small = r.sizes.filter(s => s[1] < 16); eq(small, [], 'campos abaixo de 16px');
  });

  await test('mercado: nome de loja com "|" aparece inteiro no histórico', async () => {
    await openPage(); await goto('mercado');
    const r = await ev(`const dt=new DataTransfer(); dt.items.add(new File([JSON.stringify({items:[{data:'2026-09-12',loja:'Mercado A|B',descricao:'ITEM Z',qtde:1,valorUnit:10}]})],'x.json')); const i=document.getElementById('mk-importFile'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,250)); document.getElementById('app-dialog-ok').click(); await new Promise(r=>setTimeout(r,250)); document.getElementById('app-dialog-ok').click(); await new Promise(r=>setTimeout(r,200));
      return { titulos: [...document.querySelectorAll('.grp-title')].map(t=>t.textContent), gasto: window.CF.market.summary().monthSpend }`);
    ok(r.titulos.some(t => t.includes('Mercado A|B')), 'histórico mostra: ' + JSON.stringify(r.titulos)); eq(r.gasto, 98.9, 'gasto do mês');
  });

  await test('menu lateral fechado não é focável nem lido por leitor de tela; aberto, sim', async () => {
    await openPage();
    const r = await ev(`const d=document.getElementById('drawer'), b=d.querySelector('.drawer-item'); b.focus(); const closed={vis:getComputedStyle(d).visibility, focused:document.activeElement===b};
      document.getElementById('menuBtn').click(); await new Promise(r=>setTimeout(r,350)); b.focus(); const open={vis:getComputedStyle(d).visibility, focused:document.activeElement===b};
      document.getElementById('drawerOverlay').click(); await new Promise(r=>setTimeout(r,450)); return { closed, open, closedAgain:getComputedStyle(d).visibility }`);
    eq(r.closed, { vis: 'hidden', focused: false }, 'fechado'); eq(r.open, { vis: 'visible', focused: true }, 'aberto'); eq(r.closedAgain, 'hidden', 'fechou de novo');
  });

  await test('Esc fecha: modal de compra, modal de NFC-e, menu e o diálogo de confirmação (só o de cima)', async () => {
    await openPage(); await goto('mercado');
    const r = await ev(`const esc=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); const o=id=>document.getElementById(id).classList.contains('open'); const w=ms=>new Promise(r=>setTimeout(r,ms)); const out={};
      document.getElementById('mk-addBtn').click(); await w(120); esc(); await w(120); out.compraAberto=o('mk-overlay');
      document.getElementById('mk-nfceBtn').click(); await w(120); esc(); await w(120); out.nfceAberto=o('mk-nfceOverlay');
      document.getElementById('menuBtn').click(); await w(120); esc(); await w(120); out.menuAberto=o('drawer');
      const p=window.appConfirm('teste?'); await w(100); esc(); out.confirmou=await p; out.dialogAberto=o('app-dialog-overlay');
      document.getElementById('mk-addBtn').click(); await w(120); const p2=window.appConfirm('outro?'); await w(100); esc(); await p2; await w(100); out.modalSobDialogAindaAberto=o('mk-overlay'); esc(); await w(120); out.modalFechouNoSegundoEsc=!o('mk-overlay');
      return out`);
    eq(r, { compraAberto: false, nfceAberto: false, menuAberto: false, confirmou: false, dialogAberto: false, modalSobDialogAindaAberto: true, modalFechouNoSegundoEsc: true });
  });

  await test('NFC-e: unidade PCT é mantida (não vira "PC"); KG, UN e milhar (2.499,00) corretos', async () => {
    await openPage(); await goto('mercado');
    const texto = 'ARROZ TIPO 1 5KG (Código: 123)\nQtde.: 1 UN Vl. Unit.: 27,90 Vl. Total 27,90\nPRESUNTO FATIADO\nQtde.: 0,350 KG Vl. Unit.: 39,90 Vl. Total 13,97\nGELADEIRA DUPLEX\nQtde.: 1 UN Vl. Unit.: 2.499,00 Vl. Total 2.499,00\nBISCOITO RECHEADO\nQtde.: 3 PCT Vl. Unit.: 4,00 Vl. Total 12,00\n';
    const rows = await ev(`document.getElementById('mk-nfceBtn').click(); await new Promise(r=>setTimeout(r,120)); document.getElementById('mk-nfcePasteArea').value=${JSON.stringify(texto)}; document.getElementById('mk-nfceParseBtn').click(); await new Promise(r=>setTimeout(r,250));
      const rows=[...document.querySelectorAll('#mk-nfcePreviewTable tr')].slice(1).map(r=>[...r.children].map(c=>c.textContent.trim())); document.getElementById('mk-nfceCancelBtn').click(); return rows`);
    eq(rows.map(r => [r[0], r[2]]), [['ARROZ TIPO 1 5KG', 'UN'], ['PRESUNTO FATIADO', 'KG'], ['GELADEIRA DUPLEX', 'UN'], ['BISCOITO RECHEADO', 'PCT']]);
    eq(norm(rows[2][4]), 'R$ 2.499,00');
  });

  await test('arrastar e soltar (Lista de compras): mover "Arroz 5kg" de Alimentos para Limpeza persiste', async () => {
    await openPage(); await goto('compras');
    const rect = sel => ev(`const e=document.querySelector(${JSON.stringify(sel)}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}`);
    const src = await rect('#sc-sections li[data-id="s1"] .drag-handle'), dst = await rect('#sc-sections ul[data-category="Limpeza"]');
    const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await mouse('mouseMoved', src.x, src.y); await mouse('mousePressed', src.x, src.y);
    for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', src.x, src.y + (dst.y - src.y) * i / 12 + 20); await sleep(25); }
    const during = await ev(`return !!document.querySelector('.drag-ghost') && !!document.querySelector('li.drag-placeholder')`);
    await mouse('mouseReleased', src.x, dst.y + 20); await sleep(300);
    const after = await ev(`return { cat: JSON.parse(localStorage.getItem('cf-shopping-v1')).items.find(i=>i.id==='s1').category, sobras: !!document.querySelector('.drag-ghost, li.drag-placeholder') }`);
    ok(during, 'durante o arrasto deveria haver "fantasma" e marcador de destino'); eq(after, { cat: 'Limpeza', sobras: false });
  });

  await test('telas estreitas (320 e 360 px): nenhuma tela tem rolagem horizontal', async () => {
    const bad = [];
    for (const w of [320, 360]) { await openPage({ width: w }); for (const v of ['overview', 'compras', 'despesas', 'mercado', 'comparador', 'desejos']) { await goto(v); const m = await ev(`return [document.documentElement.scrollWidth, window.innerWidth]`); if (m[0] > m[1]) bad.push(v + '@' + w + ' ' + m[0] + '>' + m[1]); } }
    eq(bad, []);
  });

  /* ---- Lista de desejos: histórico de preços MANUAL (o usuário informa o preço anunciado de cada link) ---- */
  const wlCard = name => `[...document.querySelectorAll('#wl-list .wl-item')].find(c=>c.querySelector('.wl-item-name').textContent===${JSON.stringify(name)})`;
  const openWl = name => ev(`const c=${wlCard(name)}; if(!c.querySelector('.wl-link-block')) c.querySelector('.wl-toggle-links').click(); await new Promise(r=>setTimeout(r,120));`);
  const registrar = (name, k, preco, data) => ev(`const c=${wlCard(name)}; const b=c.querySelectorAll('.wl-link-block')[${k}]; const ins=b.querySelectorAll('.wl-reg input'); ins[0].value=${JSON.stringify(preco)}; if(${JSON.stringify(data || '')}) ins[1].value=${JSON.stringify(data || '')}; b.querySelector('.wl-reg button').click(); await new Promise(r=>setTimeout(r,250));`);
  const histOf = (name, k) => ev(`const it=JSON.parse(localStorage.getItem('cf-wishlist-v1')).items.find(i=>i.name===${JSON.stringify(name)}); const l=it.links[${k}]; return { price:l.price, hist:l.history.map(e=>e.price) }`);
  const blockInfo = (name, k) => ev(`return ${wlCard(name)}.querySelectorAll('.wl-link-block')[${k}].querySelector('.wl-link-info').textContent`);

  await test('histórico manual: no formulário cada link recebe o preço anunciado; vira o 1º registro e o app calcula a média entre os links', async () => {
    await openPage(); await goto('desejos');
    const r = await ev(`document.getElementById('wl-toggleForm').click(); document.getElementById('wl-name').value='Notebook'; document.getElementById('wl-price').value='3000';
      document.getElementById('wl-addLinkField').click(); document.getElementById('wl-addLinkField').click();
      const rows=[...document.querySelectorAll('#wl-linkFields .wl-link-row')]; const dados=[['https://loja-a.exemplo/nb','3200,00'],['https://loja-b.exemplo/nb','R$ 2.900,00'],['https://loja-c.exemplo/nb','']];
      rows.forEach((row,k)=>{ const [u,p]=row.querySelectorAll('input'); u.value=dados[k][0]; u.dispatchEvent(new Event('input',{bubbles:true})); p.value=dados[k][1]; p.dispatchEvent(new Event('input',{bubbles:true})); });
      const campos=rows.map(r=>r.querySelectorAll('input').length);
      document.getElementById('wl-submit').click(); await new Promise(r=>setTimeout(r,250));
      const it=JSON.parse(localStorage.getItem('cf-wishlist-v1')).items.find(i=>i.name==='Notebook'); const card=${wlCard('Notebook')};
      return { campos, links: it.links.map(l=>[l.price, l.history.length]), resumo: card.querySelector('.wl-prices').textContent }`);
    eq(r.campos, [2, 2, 2], 'cada linha do formulário tem link + preço'); eq(r.links, [[3200, 1], [2900, 1], [0, 0]]);
    ok(/média dos links R\$ 3\.050,00/.test(norm(r.resumo)) && /menor preço R\$ 2\.900,00/.test(norm(r.resumo)), 'resumo: ' + norm(r.resumo));
  });

  await test('registrar um novo preço num link: entra no histórico, atualiza o preço atual e a média, e mostra a variação (↓/↑) e a data', async () => {
    await openPage(); await goto('desejos'); await openWl('Air fryer');
    await registrar('Air fryer', 0, '300,00');
    let h = await histOf('Air fryer', 0); eq([h.price, h.hist], [300, [329.9, 300]]);
    const r = await ev(`const c=${wlCard('Air fryer')}; const b=c.querySelectorAll('.wl-link-block')[0]; return { info: b.querySelector('.wl-link-info').textContent, trend: (b.querySelector('.wl-trend')||{}).className, resumo: c.querySelector('.wl-prices').textContent, campo: b.querySelector('.wl-reg input').value }`);
    ok(/R\$ 300,00/.test(norm(r.info)) && /registrado em 15\/09/.test(norm(r.info)), 'linha: ' + norm(r.info)); ok(/↓ R\$ 29,90/.test(norm(r.info)) && /down/.test(r.trend), 'variação: ' + norm(r.info) + ' / ' + r.trend);
    ok(/média dos links R\$ 334,95/.test(norm(r.resumo)), 'média: ' + norm(r.resumo)); eq(r.campo, '', 'campo de preço volta vazio');
    await registrar('Air fryer', 0, '320');
    const info = norm(await blockInfo('Air fryer', 0)); ok(/R\$ 320,00/.test(info) && /↑ R\$ 20,00/.test(info), 'subiu: ' + info);
    eq((await histOf('Air fryer', 0)).hist, [329.9, 300, 320]);
  });

  await test('registro com data anterior entra na ordem certa sem virar o preço atual; data futura e preço inválido são recusados', async () => {
    await openPage(); await goto('desejos'); await openWl('Air fryer');
    await registrar('Air fryer', 0, '400,00', '2026-09-01');
    let h = await histOf('Air fryer', 0); eq([h.price, h.hist], [329.9, [400, 329.9]], 'o mais antigo vem antes e o preço atual não muda');
    await registrar('Air fryer', 0, '100,00', '2026-09-30');
    ok(/data futura|futura/i.test(await ev(`return document.getElementById('wl-status').textContent`)), 'aviso de data futura');
    await registrar('Air fryer', 0, 'abc');
    ok(/Informe o preço/.test(await ev(`return document.getElementById('wl-status').textContent`)), 'aviso de preço inválido');
    eq((await histOf('Air fryer', 0)).hist, [400, 329.9], 'nada foi registrado');
    const rows = await ev(`const b=${wlCard('Air fryer')}.querySelectorAll('.wl-link-block')[0]; b.querySelector('details.wl-hist').open=true; return [...b.querySelectorAll('.wl-hist-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim())`);
    eq(rows.length, 2); ok(/15\/09/.test(rows[0]) && /R\$ 329,90/.test(rows[0]) && /↓ R\$ 70,10/.test(rows[0]), 'mais recente primeiro: ' + rows[0]); ok(/01\/09/.test(rows[1]) && /R\$ 400,00/.test(rows[1]), 'registro antigo: ' + rows[1]);
  });

  await test('excluir um registro recalcula o preço atual e a média; sem registros o link fica sem preço e sai da média', async () => {
    await openPage(); await goto('desejos'); await openWl('Air fryer');
    await registrar('Air fryer', 0, '300,00');
    const apagar = () => ev(`const b=${wlCard('Air fryer')}.querySelectorAll('.wl-link-block')[0]; b.querySelector('details.wl-hist').open=true; b.querySelector('.wl-hist-row .wl-hist-del').click(); await new Promise(r=>setTimeout(r,250));`);
    await apagar();   // apaga o mais recente (300,00)
    let h = await histOf('Air fryer', 0); eq([h.price, h.hist], [329.9, [329.9]], 'volta ao registro anterior');
    await apagar();   // apaga o último
    h = await histOf('Air fryer', 0); eq([h.price, h.hist], [0, []], 'link sem preço');
    const r = await ev(`const c=${wlCard('Air fryer')}; return { resumo: c.querySelector('.wl-prices').textContent, info: c.querySelectorAll('.wl-link-block')[0].querySelector('.wl-link-info').textContent, hist: !!c.querySelectorAll('.wl-link-block')[0].querySelector('details.wl-hist') }`);
    ok(/média dos links R\$ 369,90/.test(norm(r.resumo)), 'a média só considera o link que tem preço: ' + norm(r.resumo)); ok(/Sem preço registrado/.test(r.info), r.info); eq(r.hist, false, 'sem registros não mostra histórico');
  });

  await test('link adicionado sem preço fica fora da média até o preço ser registrado', async () => {
    await openPage(); await goto('desejos'); await openWl('Air fryer');
    await ev(`const c=${wlCard('Air fryer')}; const add=c.querySelector('.wl-link-add'); const [u,p]=add.querySelectorAll('input'); u.value='https://loja-nova.exemplo/af'; add.querySelector('button').click(); await new Promise(r=>setTimeout(r,250));`);
    let resumo = norm(await ev(`return ${wlCard('Air fryer')}.querySelector('.wl-prices').textContent`)); ok(/média dos links R\$ 349,90/.test(resumo), 'sem o novo link: ' + resumo);
    ok(/Sem preço registrado/.test(await blockInfo('Air fryer', 2)), 'novo link sem preço');
    await registrar('Air fryer', 2, '200,00');
    resumo = norm(await ev(`return ${wlCard('Air fryer')}.querySelector('.wl-prices').textContent`)); ok(/média dos links R\$ 299,93/.test(resumo), 'com o novo preço: ' + resumo);
    await ev(`const c=${wlCard('Air fryer')}; const add=c.querySelector('.wl-link-add'); const [u,p]=add.querySelectorAll('input'); u.value='https://loja-d.exemplo/af'; p.value='250,00'; add.querySelector('button').click(); await new Promise(r=>setTimeout(r,250));`);
    eq((await histOf('Air fryer', 3)), { price: 250, hist: [250] }, 'link adicionado já com preço vira o 1º registro');
  });

  await test('dados antigos (link só com "price", sem histórico) viram o 1º registro, continuam na média e ficam salvos de forma estável', async () => {
    await openPage();
    await ev(`localStorage.setItem('cf-wishlist-v1', JSON.stringify({ items:[{ id:'a', name:'Legado', expectedPrice:100, note:'', links:[{ id:'x', url:'https://a.exemplo/1', price:80 },{ id:'y', url:'https://a.exemplo/2', price:120 },{ id:'z', url:'https://a.exemplo/3', price:0 }] }] }));`);
    await reload(false); await goto('desejos');
    const t1 = await ev(`const it=JSON.parse(localStorage.getItem('cf-wishlist-v1')).items[0]; return it.links.map(l=>[l.price, l.history.length, l.history[0] && l.history[0].t])`);
    eq(t1.map(x => [x[0], x[1]]), [[80, 1], [120, 1], [0, 0]]); ok(t1[0][2] > 0, 'o 1º registro tem data');
    ok(/média dos links R\$ 100,00/.test(norm(await ev(`return ${wlCard('Legado')}.querySelector('.wl-prices').textContent`))), 'média');
    await reload(false);
    const t2 = await ev(`const it=JSON.parse(localStorage.getItem('cf-wishlist-v1')).items[0]; return it.links.map(l=>l.history[0] && l.history[0].t)`);
    eq(t2, t1.map(x => x[2]), 'a data do registro migrado não pode mudar a cada abertura do app');
  });

  await test('o alerta "abaixo do valor esperado" segue o preço atual: registrar um preço menor aumenta a economia; um maior a reduz', async () => {
    await openPage(); await goto('desejos'); await openWl('Air fryer');
    const total = () => ev(`return window.CF.wishlist.priceDrops()`);
    near((await total()).total, 349.9 - 329.9, 0.001, 'economia inicial');
    await registrar('Air fryer', 0, '300,00'); near((await total()).total, 49.9, 0.001, 'depois de registrar 300');
    await registrar('Air fryer', 0, '400,00'); await registrar('Air fryer', 1, '400,00'); eq((await total()).count, 0, 'com todos acima do esperado não há alerta');
    ok(!/caíram de preço|caiu de preço/.test(norm(await ev(`return document.getElementById('notifPanel').innerText`))), 'sino sem alerta de preço');
  });

  await test('o histórico persiste ao recarregar e o painel do histórico continua aberto depois de registrar outro preço', async () => {
    await openPage(); await goto('desejos'); await openWl('Air fryer');
    await ev(`const b=${wlCard('Air fryer')}.querySelectorAll('.wl-link-block')[0]; b.querySelector('details.wl-hist').open=true; b.querySelector('details.wl-hist').dispatchEvent(new Event('toggle'));`);
    await registrar('Air fryer', 0, '310,00');
    ok(await ev(`return ${wlCard('Air fryer')}.querySelectorAll('.wl-link-block')[0].querySelector('details.wl-hist').open`), 'histórico deveria continuar aberto');
    await reload(false); await goto('desejos'); await openWl('Air fryer');
    eq((await histOf('Air fryer', 0)).hist, [329.9, 310]); ok(/R\$ 310,00/.test(norm(await blockInfo('Air fryer', 0))), 'preço atual após recarregar');
  });

  await test('o preço registrado aceita "1.299,90", "R$ 349,90" e "349.90"', async () => {
    await openPage(); await goto('desejos'); await openWl('Air fryer');
    await registrar('Air fryer', 0, '1.299,90'); await registrar('Air fryer', 0, 'R$ 349,90'); await registrar('Air fryer', 0, '349.5');
    eq((await histOf('Air fryer', 0)).hist, [329.9, 1299.9, 349.9, 349.5]);
  });

  await test('compras: item repetido avisa e mantém o texto digitado (botão e Enter); item novo limpa o campo', async () => {
    await openPage(); await goto('compras');
    const r = await ev(`const i=document.getElementById('sc-newItemInput'); const w=()=>new Promise(r=>setTimeout(r,220));
      i.value='Arroz 5kg'; document.getElementById('sc-addBtn').click(); await w(); const dupBotao={v:i.value,s:document.getElementById('sc-status').textContent};
      i.value='Feijão'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await w(); const dupEnter=i.value;
      i.value='Ovos'; document.getElementById('sc-addBtn').click(); await w();
      return { dupBotao, dupEnter, novo:{v:i.value, salvo: JSON.parse(localStorage.getItem('cf-shopping-v1')).items.some(x=>x.name==='Ovos')} }`);
    eq(r.dupBotao.v, 'Arroz 5kg'); ok(/já está na lista/.test(r.dupBotao.s), 'aviso: ' + r.dupBotao.s); eq(r.dupEnter, 'Feijão', 'após Enter em item repetido'); eq([r.novo.v, r.novo.salvo], ['', true]);
  });

  await test('modais: role/aria-modal, o foco entra ao abrir, Tab fica preso dentro e o foco volta ao fechar', async () => {
    await openPage(); await goto('mercado');
    const tab = shift => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }));
    const FOC = `const vis=e=>e.getClientRects().length>0; const foc=ov=>[...ov.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled])')].filter(vis);`;
    const info = id => ev(`${FOC} const ov=document.getElementById('${id}'); const m=ov.querySelector('.modal'); const f=foc(ov); return { role:m.getAttribute('role'), modal:m.getAttribute('aria-modal'), nome:!!(m.getAttribute('aria-labelledby')||m.getAttribute('aria-describedby')), dentro:m.contains(document.activeElement), primeiro:f[0]===document.activeElement, ultimo:f[f.length-1]===document.activeElement }`);
    for (const [openId, ovId, closeId] of [['mk-addBtn', 'mk-overlay', 'mk-cancelBtn'], ['mk-nfceBtn', 'mk-nfceOverlay', 'mk-nfceCancelBtn']]) {
      await ev(`document.getElementById('${openId}').focus(); document.getElementById('${openId}').click(); await new Promise(r=>setTimeout(r,200));`);
      const a = await info(ovId); ok(a.role === 'dialog' && a.modal === 'true' && a.nome, ovId + ': faltam role/aria-modal/nome ' + JSON.stringify(a)); ok(a.dentro, ovId + ': o foco não entrou no modal');
      await ev(`${FOC} const f=foc(document.getElementById('${ovId}')); f[f.length-1].focus();`);
      await tab(false); await sleep(80); const b = await info(ovId); ok(b.dentro && b.primeiro, ovId + ': Tab no último campo deveria voltar ao primeiro ' + JSON.stringify(b));
      await tab(true); await sleep(80); const c = await info(ovId); ok(c.dentro && c.ultimo, ovId + ': Shift+Tab no primeiro deveria ir ao último ' + JSON.stringify(c));
      await ev(`document.getElementById('${closeId}').click(); await new Promise(r=>setTimeout(r,150));`);
      eq(await ev(`return document.activeElement.id`), openId, ovId + ': o foco deveria voltar ao botão que abriu');
    }
    const d = await ev(`const b=document.getElementById('mk-importBtn'); b.focus(); const p=window.appConfirm('Excluir?'); await new Promise(r=>setTimeout(r,150)); const m=document.querySelector('#app-dialog-overlay .modal'); const r={role:m.getAttribute('role'), modal:m.getAttribute('aria-modal'), foco:document.activeElement.id}; document.getElementById('app-dialog-cancel').click(); await p; await new Promise(r=>setTimeout(r,100)); r.volta=document.activeElement.id; return r`);
    eq(d, { role: 'alertdialog', modal: 'true', foco: 'app-dialog-cancel', volta: 'mk-importBtn' }, 'diálogo de confirmação (foco começa no botão seguro)');
  });

  await test('menu lateral: o foco entra ao abrir e volta ao botão do menu ao fechar', async () => {
    await openPage();
    const r = await ev(`const b=document.getElementById('menuBtn'); b.focus(); b.click(); await new Promise(r=>setTimeout(r,300)); const dentro=document.getElementById('drawer').contains(document.activeElement); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,450)); return { dentro, volta: document.activeElement===b }`);
    eq(r, { dentro: true, volta: true });
  });

  await test('toque: o tooltip do gráfico aparece ao tocar numa fatia e some ao tocar fora', async () => {
    await openPage(); await goto('mercado');
    await ev(`document.getElementById('mk-donutWrap').scrollIntoView({block:'center'}); await new Promise(r=>setTimeout(r,200))`);
    const pt = await ev(`const p=document.querySelector('#mk-donutWrap svg path'); const r=p.getBoundingClientRect(); for (let y=r.top+2;y<r.bottom;y+=4) for (let x=r.left+2;x<r.right;x+=4) { if (document.elementFromPoint(x,y)===p) return {x,y}; } return null`);
    ok(pt, 'não achei um ponto sobre a fatia');
    const tap = async (x, y) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250); };
    const op = () => ev(`return getComputedStyle(document.getElementById('mk-tooltip')).opacity`);
    await tap(pt.x, pt.y); eq(await op(), '1', 'tooltip após tocar na fatia'); await tap(20, 20); eq(await op(), '0', 'tooltip após tocar fora');
  });

  await test('toque: tocar numa sugestão do autocompletar (Lista de compras) preenche o campo', async () => {
    await openPage(); await goto('compras');
    await ev(`const i=document.getElementById('sc-newItemInput'); i.focus(); i.value='caf'; i.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,100));`);
    const pos = await ev(`const e=document.querySelector('#sc-suggestions .sc-suggestion-item'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.textContent}`);
    ok(pos, 'nenhuma sugestão apareceu para "caf"');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] }); await sleep(50); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(350);
    eq(await ev(`return document.getElementById('sc-newItemInput').value`), pos.t);
  });

  /* ---- virada do mês nas Despesas fixas: pagas voltam a pendente; as NÃO pagas continuam e acumulam meses ---- */
  await test('virada do mês: pagas são desmarcadas, não pagas continuam com "sem pagamento há N meses" e o usuário é avisado uma vez', async () => {
    await openPage();
    await ev(`const d=JSON.parse(localStorage.getItem('cf-expenses-v1')); d.cycle='2026-08'; d.items.find(i=>i.id==='e2').unpaidMonths=2; localStorage.setItem('cf-expenses-v1', JSON.stringify(d));`);
    await reload(false);
    const dlg = await ev(`return { aberto: document.getElementById('app-dialog-overlay').classList.contains('open'), msg: document.getElementById('app-dialog-message').textContent }`);
    ok(dlg.aberto, 'deveria avisar sobre o mês novo'); ok(/Novo mês/.test(dlg.msg) && /3 contas pagas/.test(dlg.msg) && /6 contas continuam sem pagamento/.test(dlg.msg), 'mensagem: ' + dlg.msg);
    await ev(`document.getElementById('app-dialog-ok').click(); await new Promise(r=>setTimeout(r,150));`);
    await goto('despesas');
    const r = await ev(`const d=JSON.parse(localStorage.getItem('cf-expenses-v1')); const li=n=>[...document.querySelectorAll('#ex-sections li')].find(l=>l.textContent.includes(n));
      return { cycle:d.cycle, pagas:d.items.filter(i=>i.paid).length, condo:d.items.find(i=>i.id==='e2').unpaidMonths, energia:d.items.find(i=>i.id==='e4').unpaidMonths, aluguel:d.items.find(i=>i.id==='e1').unpaidMonths,
        txCondo: li('Condomínio').textContent, txEnergia: li('Energia').textContent, txAluguel: li('Aluguel').textContent, atrasadas: document.querySelectorAll('#ex-sections li.overdue').length, comAviso: [...document.querySelectorAll('#ex-sections li')].filter(l=>/Sem pagamento há/.test(l.textContent)).length,
        hero: document.getElementById('ovDisbursedMonth').textContent, pago: document.getElementById('ex-paidValue').textContent }`);
    eq([r.cycle, r.pagas, r.condo, r.energia, r.aluguel], ['2026-09', 0, 3, 2, 1]);
    ok(/Sem pagamento há 3 meses/.test(r.txCondo) && /Sem pagamento há 2 meses/.test(r.txEnergia), 'texto nas linhas: ' + r.txCondo + ' | ' + r.txEnergia);
    ok(!/Sem pagamento/.test(r.txAluguel), 'conta que estava paga não deve ter o aviso'); eq(r.comAviso, 6, 'linhas com "Sem pagamento há N meses"'); eq(r.atrasadas, 9, 'linhas atrasadas (6 vindas do mês anterior + 3 que voltaram a pendente com o vencimento já passado)');
    eq(norm(r.pago), 'R$ 0,00', 'Pago do mês novo');
  });

  await test('virada do mês: dados antigos (sem registro do mês) só registram o mês atual e não reiniciam nada; reabrir no mesmo mês também não', async () => {
    await openPage();
    const antes = await ev(`const d=JSON.parse(localStorage.getItem('cf-expenses-v1')); return { cycle:d.cycle, pagas:d.items.filter(i=>i.paid).length, dialog:document.getElementById('app-dialog-overlay').classList.contains('open') }`);
    eq(antes, { cycle: '2026-09', pagas: 3, dialog: false });
    await reload(false);
    const depois = await ev(`const d=JSON.parse(localStorage.getItem('cf-expenses-v1')); return { cycle:d.cycle, pagas:d.items.filter(i=>i.paid).length, dialog:document.getElementById('app-dialog-overlay').classList.contains('open') }`);
    eq(depois, { cycle: '2026-09', pagas: 3, dialog: false });
  });

  await test('virada do mês com o app aberto (volta do segundo plano em 01/10 00:30): reinicia e avisa', async () => {
    await openPage();
    const r = await ev(`window.__setNow('2026-10-01T03:30:00Z'); document.dispatchEvent(new Event('visibilitychange')); await new Promise(r=>setTimeout(r,250));
      const d=JSON.parse(localStorage.getItem('cf-expenses-v1')); return { cycle:d.cycle, pagas:d.items.filter(i=>i.paid).length, msg: document.getElementById('app-dialog-message').textContent, aberto: document.getElementById('app-dialog-overlay').classList.contains('open') }`);
    eq([r.cycle, r.pagas, r.aberto], ['2026-10', 0, true]); ok(/Novo mês/.test(r.msg), 'mensagem: ' + r.msg);
  });

  await test('"Reiniciar mês" (Despesas) e "Desmarcar tudo" (Compras) pedem confirmação antes de desmarcar', async () => {
    await openPage(); await goto('despesas');
    const r = await ev(`const w=()=>new Promise(r=>setTimeout(r,200)); const pagas=()=>JSON.parse(localStorage.getItem('cf-expenses-v1')).items.filter(i=>i.paid).length; const marc=()=>JSON.parse(localStorage.getItem('cf-shopping-v1')).items.filter(i=>i.checked).length;
      document.getElementById('ex-resetBtn').click(); await w(); const aberto1=document.getElementById('app-dialog-overlay').classList.contains('open'); document.getElementById('app-dialog-cancel').click(); await w(); const depoisCancelar=pagas();
      document.getElementById('ex-resetBtn').click(); await w(); document.getElementById('app-dialog-ok').click(); await w(); const depoisConfirmar=pagas();
      document.querySelector('[data-view=compras]').click(); await w();
      document.getElementById('sc-resetBtn').click(); await w(); const aberto2=document.getElementById('app-dialog-overlay').classList.contains('open'); document.getElementById('app-dialog-cancel').click(); await w(); const cCancelar=marc();
      document.getElementById('sc-resetBtn').click(); await w(); document.getElementById('app-dialog-ok').click(); await w(); const cConfirmar=marc();
      return { aberto1, depoisCancelar, depoisConfirmar, aberto2, cCancelar, cConfirmar }`);
    eq(r, { aberto1: true, depoisCancelar: 3, depoisConfirmar: 0, aberto2: true, cCancelar: 2, cConfirmar: 0 });
  });

  /* ================================================================ 9. PWA offline (por último: derruba o servidor) */
  group('PWA offline');
  await test('o service worker cacheia o app e ele abre e navega com o servidor DESLIGADO', async () => {
    await openPage();
    ok(await ev(`const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r=>setTimeout(()=>r(null),8000))]); return !!(reg && reg.active)`), 'o service worker não ficou ativo');
    let cached = 0; for (let i = 0; i < 40 && cached < 7; i++) { cached = await ev(`const k=await caches.keys(); if(!k.length) return 0; const c=await caches.open(k[0]); return (await c.keys()).length`); await sleep(150); }
    ok(cached >= 7, 'cache incompleto: ' + cached + ' arquivos (esperado ao menos 7: página, manifest e 4 ícones)');
    const cacheName = await ev(`return (await caches.keys())[0]`);
    ok(/^controle-financeiro-v[0-9]+$/.test(cacheName), 'nome do cache inesperado: ' + cacheName);
    server.closeAllConnections(); await new Promise(r => server.close(r));   // sem internet DE VERDADE
    await reload(true);
    eq(await ev(`return document.title`), 'Controle Financeiro');
    eq(await goto('desejos'), 'Lista de desejos');
    eq(norm(await ev(`return document.getElementById('ovDisbursedMonth').textContent`)) !== '', true, 'visão geral renderizou');
  });

  /* ================================================================ fechamento */
  group('Erros de JavaScript durante toda a execução');
  await test('nenhuma exceção nem console.error', async () => { eq(errors, []); });

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passaram, ' + fail + ' falharam' + (fail ? '\n  falhas: ' + failures.join(' | ') : ''));
  ws.close(); proc.kill(); try { server.close(); } catch (e) { /* já foi desligado pelo teste offline */ }
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* o navegador pode segurar arquivos por um instante; é só cache temporário */ }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE:', e); process.exit(2); });
