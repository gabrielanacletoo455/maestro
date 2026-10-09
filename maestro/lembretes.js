// Lembretes automaticos: o Maestro escolhe, sem IA, o que vale o Claude saber agora.
//  - briefing(branch): resumo da task atual + tasks parecidas do passado (inicio da conversa)
//  - lembretes(prompt): ate 3 trechos anotados ligados ao que o usuario acabou de pedir

import { loadIndex, normalize, tokenize, STOP, expand, score, breadcrumb, window, fmt, APP_URL } from './maestro.js';

const MEMORAVEL = /convers|documentac|backend|duvida|decis|lico|review|permiss|pendenc|resoluc|validac|contrato|o que foi feito|historico|causa|correc/;
const RUIDO = new Set(
  `tela telas botao componente componentes task tasks feature bugfix hotfix fazer feito criar ajustar ajuste
   ajustes novo nova novos novas pagina arquivo codigo front web app mobile usuario dados campo campos
   melhorias melhoria aplicar exibir mostrar lista listagem item itens fluxo vamos agora preciso pode
   ver olha olhar coloca colocar deixa deixar muda mudar troca trocar faz testa testar ok sim beleza
   ajusta ajustar ajustado ajustada salvar salva salvo implementa implementar cria corrige corrigir
   commit commits abre abrir abra pr prs push merge branch pull request roda rodar rode build
   erro erros exibe exibir exibimos exibindo mostra instalar instalacao instala terminal motivo
   subir sobe baixar baixa versao vez coisa coisas jeito forma algo nada tudo certo errado
   tambem claude projeto skill node verificar duvida duvidas
   entao vai vou vamos ta to ne pq porque depois antes ainda so mesmo bem mal ali oq ue cara mano blz
   ser sera seria estou estamos tava tinha teria dar deu dando acho achei parece ficou fica ficar
   falta faltando faltou automatica automatico automaticamente manual passar usar usa usando`.split(/\s+/)
);

const BRIEFING_CHARS = 2000;
const PAGINA_CHARS = 1300;
const LINHA = 170;

/* ------------------------------- task atual -------------------------------- */

export function taskIdFromBranch(branch = '') {
  return branch.match(/^(?:feature|feat|bugfix|fix|hotfix)\/([a-z0-9]{6,12})-/i)?.[1]?.toLowerCase() ?? null;
}

function branchWords(branch = '') {
  return branch
    .replace(/^[\w-]+\//, '')
    .replace(/^[a-z0-9]{6,12}-/i, '')
    .split(/[-_/]+/)
    .filter(Boolean);
}

export function findTaskPage(index, branch) {
  if (!branch) return null;
  const id = taskIdFromBranch(branch);
  const live = index.live.filter((p) => p.kind === 'task' || p.kind === 'bug');
  const branchNorm = normalize(branch);

  const byBranch = live.find((p) => p.blocks.slice(0, 6).some((b) => b.norm.includes(branchNorm)));
  if (byBranch) return byBranch;
  if (!id) return null;
  const byHeader = live.find((p) =>
    p.blocks.slice(0, 6).some((b) => new RegExp(`(task|chamado) clickup\\W+${id}\\b`).test(b.norm))
  );
  if (byHeader) return byHeader;
  return live.find((p) => normalize(p.title).includes(id)) ?? null;
}

/* -------------------------------- briefing --------------------------------- */

const SECOES_BRIEFING = [
  { re: /convers/, label: 'Conversas', max: 4 },
  { re: /documentac|backend|contrato/, label: 'Documentacao', max: 4, headingsFirst: true },
  { re: /duvida/, label: 'Duvidas', max: 3 },
  { re: /pendenc/, label: 'Pendencias abertas', max: 4, openTodos: true },
  { re: /permiss/, label: 'Permissoes', max: 3, headingsFirst: true },
  { re: /lico/, label: 'Licoes', max: 2 },
  { re: /resoluc|validac/, label: 'Resolucao', max: 2 },
];

function curto(text, size = LINHA) {
  const flat = text.replace(/\s*\n\s*/g, ' | ').trim();
  return flat.length <= size ? flat : `${flat.slice(0, size - 1).trim()}…`;
}

function resumoDaPagina(page) {
  const linhas = [];
  for (const sec of SECOES_BRIEFING) {
    const blocos = page.blocks.filter((b) => sec.re.test(normalize(b.section)));
    if (!blocos.length) continue;
    let itens;
    if (sec.headingsFirst) {
      itens = blocos.filter((b) => b.type === 'heading3').map((b) => b.text);
      if (!itens.length) itens = blocos.filter((b) => !b.type.startsWith('heading')).map((b) => b.text);
    } else if (sec.openTodos) {
      itens = blocos.filter((b) => b.type === 'todo' && !b.checked).map((b) => `☐ ${b.text}`);
    } else {
      itens = blocos.filter((b) => !b.type.startsWith('heading')).map((b) => b.text);
    }
    itens = itens.filter((t) => t.trim().length > 3);
    if (!itens.length) continue;
    linhas.push(`${sec.label}:`);
    for (const t of itens.slice(0, sec.max)) linhas.push(`  - ${curto(t)}`);
    if (itens.length > sec.max) linhas.push(`  (+${itens.length - sec.max} na pagina)`);
  }
  return linhas;
}

function termosDaTask(index, page, branch) {
  const fontes = [branchWords(branch).join(' ')];
  if (page) {
    fontes.push(page.title);
    const desc = page.blocks.filter((b) => /descric/.test(normalize(b.section)) && !b.type.startsWith('heading'));
    fontes.push(desc.slice(0, 6).map((b) => b.text).join(' '));
  }
  const N = index.live.length;
  const termos = [...new Set(fontes.flatMap(tokenize))].filter(
    (t) => t.length >= 3 && !STOP.has(t) && !RUIDO.has(t) && !/^\d+$/.test(t) && (index.vocab.get(t) ?? 0) <= N * 0.35
  );
  return termos.map((term) => ({ term, matches: expand(term, index.vocab) })).filter((t) => t.matches.length);
}

function melhorTrecho(page, terms, filtro = MEMORAVEL) {
  const words = new Set(terms.flatMap((t) => t.matches));
  let best = null;
  for (const b of page.blocks) {
    if (b.type.startsWith('heading') || b.type === 'code') continue;
    const semSecoes = !page.blocks.some((x) => x.type.startsWith('heading'));
    if (!semSecoes && !filtro.test(normalize(b.section))) continue;
    const toks = tokenize(b.text);
    const hits = toks.filter((t) => words.has(t));
    if (!hits.length) continue;
    const s = new Set(hits).size + (filtro.test(normalize(b.section)) ? 0.5 : 0);
    if (!best || s > best.s) best = { b, s, hit: hits[0] };
  }
  if (!best) return null;
  const at = Math.max(0, best.b.norm.indexOf(best.hit));
  return { bloco: best.b, texto: window(best.b.text, at, LINHA + 40) };
}

export function briefing({ branch, now = Date.now() } = {}) {
  const index = loadIndex();
  const page = findTaskPage(index, branch);
  const linhas = [];

  if (page) {
    linhas.push(`Task atual: "${page.title}" — ${breadcrumb(page)} — ${APP_URL}/#${page.id}`);
    let usado = linhas[0].length;
    for (const l of resumoDaPagina(page)) {
      if (usado + l.length > PAGINA_CHARS) {
        linhas.push('  (resumo cortado; veja a pagina)');
        break;
      }
      linhas.push(l);
      usado += l.length + 1;
    }
  }

  const terms = termosDaTask(index, page, branch);
  if (terms.length) {
    const plan = { terms };
    const candidatas = index.live
      .filter((p) => (p.kind === 'task' || p.kind === 'bug') && p !== page)
      .map((p) => ({ p, s: score(p, plan, index) }))
      .filter((x) => x.s >= 6)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);
    const parecidas = candidatas
      .map(({ p }) => ({ p, trecho: melhorTrecho(p, terms) }))
      .filter((x) => x.trecho);
    if (parecidas.length) {
      linhas.push('Tasks parecidas que voce ja fez:');
      for (const { p, trecho } of parecidas) {
        const onde = p.sprint ? p.sprint.title : breadcrumb(p);
        linhas.push(`  - "${p.title}" (${onde}) ${APP_URL}/#${p.id}`);
        linhas.push(`    ${trecho.bloco.section ? `${trecho.bloco.section}: ` : ''}${trecho.texto}`);
      }
    }
  }

  if (!linhas.length) return '';
  let corpo = linhas.join('\n');
  if (corpo.length > BRIEFING_CHARS) corpo = `${corpo.slice(0, BRIEFING_CHARS)}…`;
  return [
    '📒 Maestro (memoria local do usuario, gerada automaticamente):',
    corpo,
    'Use isto para lembrar o usuario quando for relevante para o que ele pedir: cite a data e a fonte',
    '(ex.: "no dia 08/10 o Vinicius disse..."). Se o que for feito contradizer algo daqui, avise.',
    'Nao repita este bloco nem comente sobre ele se nao for util. Detalhes: comando `maestro "pergunta"`.',
  ].join('\n');
}

/* ------------------------- lembretes por mensagem -------------------------- */

const DATA_RE = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;

export function lembretes(prompt, { vistos = new Set(), limite = 3 } = {}) {
  const index = loadIndex();
  const N = index.live.length;
  const termos = [...new Set(tokenize(prompt))].filter(
    (t) => t.length >= 3 && !STOP.has(t) && !RUIDO.has(t) && !/^\d+$/.test(t)
  );
  if (!termos.length) return { texto: '', chaves: [] };

  // Aqui a expansao e conservadora: palavra exata (ou plural), e erro de digitacao so
  // em palavra que nao existe nas notas. Prefixo solto ("ajusta" -> "ajustado") vira ruido.
  const expandidos = termos.map((term) => {
    if (index.vocab.has(term)) {
      const formas = [term.replace(/es$/, ''), term.replace(/s$/, ''), `${term}s`, `${term}es`];
      return { term, exato: true, matches: [term, ...new Set(formas.filter((w) => w !== term && index.vocab.has(w)))] };
    }
    const typos = expand(term, index.vocab).filter(
      (w) => Math.abs(w.length - term.length) <= 1 && !(w.startsWith(term) && w.length > term.length + 0)
    );
    return { term, matches: term.length >= 5 ? typos.filter((w) => !RUIDO.has(w) && !STOP.has(w)) : [] };
  });
  const idf = (w) => Math.log(N / Math.max(1, index.vocab.get(w) ?? N));

  const achados = [];
  for (const page of index.live) {
    if (page.kind === 'sprint' || page.kind === 'container') continue;
    const semSecoes = !page.blocks.some((b) => b.type.startsWith('heading'));
    for (const b of page.blocks) {
      if (b.type.startsWith('heading') || b.type === 'code' || b.text.length < 25) continue;
      if (!semSecoes && !MEMORAVEL.test(normalize(b.section))) continue;
      const toks = new Set(tokenize(b.text));
      let total = 0;
      let distintos = 0;
      let raro = false;
      let especifico = false;
      let hit = null;
      for (const { matches, exato } of expandidos) {
        const m = matches.find((w) => toks.has(w));
        if (!m) continue;
        distintos += 1;
        total += idf(m);
        const df = index.vocab.get(m) ?? 99;
        if ((df <= 1 && m.length >= (exato ? 5 : 7)) || (df <= 2 && m.length >= 10)) raro = true;
        if (df <= 5) especifico = true;
        hit ??= m;
      }
      // Pagina sem secoes e rascunho solto: exige mais evidencia para nao virar ruido.
      const minimo = semSecoes ? 3 : 2;
      const passa = (especifico && distintos >= minimo && total >= 5.5) || (raro && total >= 3.5 && distintos >= minimo - 1);
      if (!passa) continue;
      const chave = `${page.id}:${b.norm.slice(0, 60)}`;
      achados.push({ page, b, total: total + distintos, hit, chave });
    }
  }

  achados.sort((a, b) => b.total - a.total);
  const corte = (achados[0]?.total ?? 0) * 0.6;
  const escolhidos = [];
  const porPagina = new Map();
  for (const a of achados) {
    if (a.total < corte) break;
    if (vistos.has(a.chave)) continue;
    const n = porPagina.get(a.page.id) ?? 0;
    if (n >= 2) continue;
    porPagina.set(a.page.id, n + 1);
    escolhidos.push(a);
    if (escolhidos.length >= limite) break;
  }
  if (!escolhidos.length) return { texto: '', chaves: [] };

  const linhas = escolhidos.map(({ page, b, hit }) => {
    const data = b.text.match(DATA_RE)?.[1] ?? b.heading.match(DATA_RE)?.[1] ?? b.section.match(DATA_RE)?.[1] ?? fmt(page.created).slice(0, 10);
    const secao = b.section ? ` › ${curto(b.section, 60)}` : '';
    const at = Math.max(0, b.norm.indexOf(hit));
    return `- ${data} · "${page.title}"${secao}: ${window(b.text, at, 220)} (${APP_URL}/#${page.id})`;
  });
  const texto = [
    '📒 Maestro — anotacoes do usuario ligadas a esta mensagem (busca local automatica):',
    ...linhas,
    'Se algo aqui for relevante (ja foi feito, foi decidido, alguem disse, contradiz o pedido), avise o',
    'usuario citando data e fonte. Se nao for relevante, ignore em silencio.',
  ].join('\n');
  return { texto, chaves: escolhidos.map((a) => a.chave) };
}
