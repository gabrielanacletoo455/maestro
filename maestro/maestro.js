// Maestro: busca local nas notas, sem IA. Le so o espelho (notas-md/_original.json),
// nunca o banco. Entende sprint/task/bug, datas em portugues, links de ClickUp/PR e
// tolera erro de digitacao. Devolve so os trechos certos, dentro de um limite de tamanho.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(process.env.MIRROR_DIR ?? join(ROOT, 'notas-md'), '_original.json');
export const APP_URL = `http://localhost:${process.env.PORT ?? 4321}`;
export const TZ_OFFSET_H = -3;
const MAX_CHARS = 3000;

/* -------------------------------- texto ----------------------------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" };

function htmlToText(html = '') {
  return html
    .replace(/<br\s*\/?>|<div[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export const normalize = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const tokenize = (s) => normalize(s).match(/[a-z0-9]{2,}/g) ?? [];

export const STOP = new Set(`
a o os as um uma uns umas de do da dos das d em no na nos nas num numa para pra pro por pelo pela com sem
que qual quais quem como onde quando e ou mas se sim nao sobre ja ai la aqui isso isto esse essa esses essas este esta
eu me mim minha meu minhas meus voce vc ele ela eles elas nele nela neles nelas dele dela deles delas lhe nos
foi foram era eram ser estar esta estao estava tem tinha tenho ter teve havia ha alguma algum algumas alguns
pode poderia consegue encontrar encontra encontar achar ache acha verificar verifica dizer diga dar de me
preciso quero queria lembro lembrar sei saber fiz fez feito trabalhei trabalhou trabalhando criei criou
mais muito muita muitos muitas varias varios todo toda todos todas tudo cada outro outra
anotacao anotacoes nota notas pagina paginas link links abrir navegador navegado salvei salvou
dia dias esses ultimos recente recentemente ontem hoje semana mes passada passado atual nessa nesta antiga antigo antigas antigos
sprint task tasks tarefa tarefas bug bugs chamado chamados
`.split(/\s+/).filter(Boolean));

/* --------------------------------- indice ---------------------------------- */

const LINK_RE = /href="([^"]+)"|(https?:\/\/[^\s"<]+)/g;

export function loadIndex() {
  let data = { pages: [] };
  try {
    data = JSON.parse(readFileSync(SOURCE, 'utf8'));
  } catch {
    // Sem espelho ainda (app nunca rodou ou esta desligado): indice vazio, sem quebrar.
  }
  const pages = [];

  const walk = (list, parent) => {
    for (const p of list) {
      const page = {
        id: p.id,
        title: (p.title || '').trim(),
        parent,
        trash: Boolean(p.in_trash) || Boolean(parent?.trash),
        created: localDate(p.created_at),
        updated: localDate(p.updated_at),
        blocks: [],
        links: [],
        children: [],
      };
      let heading = '';
      let section = '';
      for (const b of p.blocks) {
        const text = htmlToText(b.content);
        if (b.type.startsWith('heading')) heading = text;
        if (b.type === 'heading1' || b.type === 'heading2') section = text;
        for (const m of (b.content ?? '').matchAll(LINK_RE)) page.links.push(m[1] ?? m[2]);
        if (text) {
          page.blocks.push({
            type: b.type,
            text,
            heading,
            section,
            checked: Boolean(b.props?.checked),
            norm: normalize(text),
          });
        }
      }
      page.clickup = unique(page.links.filter((l) => /clickup\.com/.test(l)));
      page.prs = unique(page.links.filter((l) => /\/pull\/\d+/.test(l)));
      parent?.children.push(page);
      pages.push(page);
      walk(p.children ?? [], page);
    }
  };
  walk(data.pages, null);

  for (const page of pages) classify(page);
  const sprints = pages
    .filter((p) => p.kind === 'sprint')
    .sort((a, b) => (a.sprintDate ?? 0) - (b.sprintDate ?? 0));

  const vocab = new Map();
  for (const page of pages) {
    page.titleTokens = tokenize(page.title);
    page.headTokens = page.blocks.filter((b) => b.type.startsWith('heading')).flatMap((b) => tokenize(b.text));
    page.bodyTokens = page.blocks.flatMap((b) => tokenize(b.text));
    page.tf = { title: count(page.titleTokens), head: count(page.headTokens), body: count(page.bodyTokens) };
    for (const t of new Set([...page.titleTokens, ...page.bodyTokens])) vocab.set(t, (vocab.get(t) ?? 0) + 1);
  }
  const live = pages.filter((p) => !p.trash);
  const avgLen = live.reduce((s, p) => s + p.bodyTokens.length, 0) / Math.max(1, live.length);

  return { pages, live, sprints, vocab, avgLen };
}

const EXCLUDED_TITLE = /^(apresenta|analise|1:1)/;
const CONTAINER_TITLE = /^bugs\b/;

function classify(page) {
  const t = normalize(page.title);
  const date = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (/^sprint\b/.test(t)) {
    page.kind = 'sprint';
    if (date) page.sprintDate = Date.UTC(2000 + (+date[3] % 100), +date[2] - 1, +date[1]);
    return;
  }
  page.sprint = ancestor(page, (a) => /^sprint\b/.test(normalize(a.title)));
  const blocked = ancestor(page, (a) => EXCLUDED_TITLE.test(normalize(a.title)));
  if (CONTAINER_TITLE.test(t)) page.kind = 'container';
  else if (page.sprint && !blocked && page.title && !EXCLUDED_TITLE.test(t)) {
    const inBugs = ancestor(page, (a) => CONTAINER_TITLE.test(normalize(a.title)));
    page.kind = inBugs || /^\[/.test(page.title) ? 'bug' : 'task';
  } else page.kind = 'page';
}

function ancestor(page, test) {
  for (let a = page.parent; a; a = a.parent) if (test(a)) return a;
  return null;
}

/* ------------------------------ entender a pergunta ------------------------ */

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];
const DAY = 86400000;

function parseQuery(query, index, now) {
  const q = normalize(query);
  const plan = { filters: [], labels: [], intents: new Set(), all: false };
  const has = (re) => re.test(q);

  // tipo
  if (has(/\b(bugs?|chamados?)\b/)) {
    plan.filters.push((p) => p.kind === 'bug');
    plan.labels.push('bugs');
  } else if (has(/\b(tasks?|tarefas?)\b/)) {
    plan.filters.push((p) => p.kind === 'task' || p.kind === 'bug');
    plan.labels.push('tasks');
  }

  // sprint
  const { sprints } = index;
  let sprint = null;
  const byDate = q.match(/sprint\s+(?:de\s+|do\s+)?(\d{1,2})\s*(?:\/|do|de)\s*(\d{1,2})/);
  if (byDate) {
    sprint = sprints.find((s) => {
      const d = new Date(s.sprintDate);
      return d.getUTCDate() === +byDate[1] && d.getUTCMonth() + 1 === +byDate[2];
    });
  } else if (has(/sprint (passada|anterior)|ultima sprint/)) {
    const current = currentSprint(sprints, now);
    sprint = sprints[sprints.indexOf(current) - 1];
  } else if (has(/(sprint atual|nessa sprint|nesta sprint|essa sprint|sprint nova)/)) {
    sprint = currentSprint(sprints, now);
  } else {
    sprint = sprints.find((s) => {
      const name = normalize(s.title).replace(/^sprint\s+/, '').split(/[\s-]/)[0];
      return name.length > 2 && !/^\d/.test(name) && q.includes(`sprint ${name}`);
    });
  }
  if (sprint) {
    plan.filters.push((p) => p.sprint === sprint);
    plan.labels.push(sprint.title);
  }

  // datas
  const range = parseDate(q, now);
  if (range) {
    plan.filters.push((p) => p.created >= range.from && p.created < range.to);
    plan.labels.push(range.label);
  }

  // intencoes
  if (has(/mais antig/)) plan.intents.add('oldest');
  if (has(/mais recente|ultima anotacao|ultimas anotacoes/)) plan.intents.add('newest');
  if (has(/sem (o )?(link (do |de )?)?(pr|pull)/)) plan.intents.add('missingPr');
  else if (has(/\b(pr|prs|pull request)\b/)) plan.intents.add('pr');
  if (has(/sem (o )?(link (do |de )?)?clickup/)) plan.intents.add('missingClickup');
  else if (has(/clickup/)) plan.intents.add('clickup');
  if (has(/arquivos?|componentes?/)) plan.intents.add('files');
  if (has(/permiss/)) plan.intents.add('permissions');
  if (has(/alterei|alterou|mudei|mudou|corrigi|correcao|o que (eu )?fiz/)) plan.intents.add('changes');
  if (has(/conversa|falou|falei|disse|comentou|comentario/)) plan.intents.add('conversation');
  if (has(/\btod[oa]s\b/) || plan.intents.has('missingPr') || plan.intents.has('missingClickup')) plan.all = true;

  // termos de conteudo
  const sprintWords = new Set(sprint ? tokenize(sprint.title) : []);
  const terms = unique(
    tokenize(query).filter((t) => !STOP.has(t) && !sprintWords.has(t) && !/^\d+$/.test(t) && !MONTHS.includes(t))
  );
  plan.terms = terms
    .map((term) => ({ term, matches: expand(term, index.vocab) }))
    .filter((t) => t.matches.length);
  if (!plan.terms.length && plan.filters.length) plan.all = true;
  return plan;
}

export function currentSprint(sprints, now) {
  return sprints.find((s) => s.sprintDate >= startOfDay(now)) ?? sprints.at(-1);
}

function parseDate(q, now) {
  const today = startOfDay(now);
  if (/\bhoje\b/.test(q)) return { from: today, to: today + DAY, label: 'hoje' };
  if (/\bontem\b/.test(q)) return { from: today - DAY, to: today, label: 'ontem' };
  if (/esses dias|ultimos dias|recentemente|\brecente/.test(q)) return { from: today - 7 * DAY, to: today + DAY, label: 'ultimos 7 dias' };
  if (/semana passada/.test(q)) return { from: today - 14 * DAY, to: today - 7 * DAY, label: 'semana passada' };
  const day = q.match(/\bdia (\d{1,2})(?:\/(\d{1,2}))?/);
  if (day) {
    const d = new Date(today);
    if (day[2]) d.setUTCMonth(+day[2] - 1);
    d.setUTCDate(+day[1]);
    const from = d.getTime();
    return { from, to: from + DAY, label: `dia ${day[1]}${day[2] ? '/' + day[2] : ''}` };
  }
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(q));
  if (month >= 0) {
    const ref = new Date(today);
    const year = month > ref.getUTCMonth() ? ref.getUTCFullYear() - 1 : ref.getUTCFullYear();
    return { from: Date.UTC(year, month, 1), to: Date.UTC(year, month + 1, 1), label: MONTHS[month] };
  }
  return null;
}

/** Termo da pergunta -> palavras do indice: exata, plural/prefixo e erro de digitacao. */
export function expand(term, vocab) {
  if (vocab.has(term)) {
    const out = [term];
    for (const base of [term.replace(/es$/, ''), term.replace(/s$/, '')]) {
      if (base !== term && base.length >= 4 && vocab.has(base)) out.push(base);
    }
    for (const w of vocab.keys()) if (w !== term && term.length >= 5 && w.startsWith(term) && w.length - term.length <= 3) out.push(w);
    return out;
  }
  const out = [];
  const maxDist = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
  for (const w of vocab.keys()) {
    if (term.length >= 5 && (w.startsWith(term) || term.startsWith(w)) && Math.abs(w.length - term.length) <= 3 && w.length >= 4) out.push(w);
    else if (maxDist && Math.abs(w.length - term.length) <= maxDist && levenshtein(term, w) <= maxDist) out.push(w);
  }
  return out;
}

/* --------------------------------- ranking --------------------------------- */

export function score(page, plan, index) {
  const N = index.live.length;
  let total = 0;
  let hit = 0;
  for (const { matches } of plan.terms) {
    let best = 0;
    for (const w of matches) {
      const df = index.vocab.get(w) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const tfBody = page.tf.body.get(w) ?? 0;
      const len = page.bodyTokens.length / index.avgLen;
      const body = (tfBody * 2.2) / (tfBody + 1.2 * (0.25 + 0.75 * len));
      const s = idf * (5 * (page.tf.title.get(w) ?? 0) + 1.5 * Math.min(3, page.tf.head.get(w) ?? 0) + body);
      best = Math.max(best, s);
    }
    if (best > 0) hit += 1;
    total += best;
  }
  if (plan.terms.length > 1 && hit === plan.terms.length) total *= 1.3;
  return total;
}

/* --------------------------------- trechos --------------------------------- */

const INTENT_WORDS = {
  permissions: /permiss/,
  changes: /correc|passou a|alterad|ajust|mudanc/,
  conversation: /convers|disse|falou|comentou|responsavel|contrato|prs? /,
  files: /\b(criad[oa]s?|criei|componente)\b/,
};

function snippets(page, plan, limit, size, index) {
  const all = plan.terms.flatMap((t) => t.matches);
  const inTitle = new Set(page.titleTokens);
  const rest = all.filter((w) => !inTitle.has(w));
  const words = rest.length || plan.intents.size ? rest : all;
  const weight = (w) => Math.log(1 + index.live.length / (index.vocab.get(w) ?? 1));
  const intentRes = [...plan.intents].map((i) => INTENT_WORDS[i]).filter(Boolean);
  const scored = page.blocks
    .filter((b) => !b.type.startsWith('heading') && b.type !== 'code')
    .map((b, i) => {
      const toks = new Set(tokenize(b.text));
      let s = words.filter((w) => toks.has(w)).reduce((sum, w) => sum + weight(w), 0);
      for (const re of intentRes) if (re.test(b.norm)) s += 3;
      return { b, s, i };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit);

  return scored.map(({ b }) => {
    const anchor = firstHit(b.norm, [...intentRes, ...words.map((w) => new RegExp(`\\b${w}`))]);
    const text = window(b.text, anchor, size);
    return `${b.heading ? `§ ${b.heading} › ` : ''}${text}`;
  });
}

function firstHit(norm, regexes) {
  let at = -1;
  for (const re of regexes) {
    const m = norm.search(re);
    if (m >= 0 && (at < 0 || m < at)) at = m;
  }
  return Math.max(0, at);
}

export function window(text, at, size) {
  const flat = text.replace(/\s*\n\s*/g, ' | ');
  if (flat.length <= size) return flat;
  const start = Math.max(0, Math.min(at - 60, flat.length - size));
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + size).trim()}…`;
}

function filesOf(page) {
  const out = new Map();
  for (const b of page.blocks) {
    if (!/\b(criad[oa]s?|criei|novos?|novas?|componente)\b/.test(b.norm)) continue;
    for (const m of b.text.matchAll(/\bsrc\/[\w/[\]-]+(?:\.\w+)?\/?|\b[\w-]+\.(?:tsx?|jsx?|svg|json|png)\b|\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+){2,}\b/g)) {
      out.set(m[0], (out.get(m[0]) ?? 0) + 1);
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 20);
}

/* ---------------------------------- saida ---------------------------------- */

export function ask(query, { now = Date.now() } = {}) {
  const index = loadIndex();
  const nowLocal = now + TZ_OFFSET_H * 3600000;
  const plan = parseQuery(query, index, nowLocal);

  let results = index.live.filter((p) => plan.filters.every((f) => f(p)));
  if (!plan.filters.length && !plan.intents.has('oldest') && !plan.intents.has('newest')) {
    results = results.filter((p) => p.kind !== 'sprint' && p.kind !== 'container');
  }
  if (plan.intents.has('missingPr')) results = results.filter((p) => !p.prs.length);
  if (plan.intents.has('missingClickup')) results = results.filter((p) => !p.clickup.length);

  for (const p of results) p._score = score(p, plan, index);
  const needsMatch = plan.terms.length && !plan.all && !plan.intents.has('oldest') && !plan.intents.has('newest');
  if (needsMatch) results = results.filter((p) => p._score > 0);

  if (plan.intents.has('oldest')) results.sort((a, b) => a.created - b.created);
  else if (plan.intents.has('newest')) results.sort((a, b) => b.created - a.created);
  else results.sort((a, b) => b._score - a._score || b.updated - a.updated);

  const limit = plan.all ? 20 : plan.intents.has('oldest') || plan.intents.has('newest') ? 3 : 5;
  const total = results.length;
  results = results.slice(0, limit);
  if (needsMatch && results.length) {
    const top = results[0]._score;
    results = results.filter((p) => p._score >= top * 0.3);
  }
  const listMode = plan.all || plan.intents.has('oldest') || plan.intents.has('newest');
  const snippetCount = listMode && !plan.terms.length ? 0 : 3 + Math.max(0, results.length - 1);
  const size = snippetCount ? Math.max(260, Math.min(900, Math.floor(2000 / snippetCount))) : 0;

  const filtros = [...plan.labels, ...plan.terms.map((t) => t.term)].join(' · ');
  const lines = [`🎼 Maestro — ${total} resultado(s)${filtros ? ` para: ${filtros}` : ''}`];
  if (!results.length) {
    lines.push('Nada encontrado nas notas. Tente outras palavras (sinonimos, nome da task, nome de pessoa).');
    return lines.join('\n');
  }

  results.forEach((p, i) => {
    const where = breadcrumb(p);
    lines.push('');
    lines.push(`${i + 1}. ${p.title || 'Sem titulo'}${where ? ` — ${where}` : ''} · criada ${fmt(p.created)}`);
    lines.push(`   ${APP_URL}/#${p.id}`);
    const links = [];
    if (p.clickup.length) links.push(`ClickUp: ${p.clickup.join(' ')}`);
    else if (plan.intents.has('clickup')) links.push('ClickUp: nenhum link salvo');
    if (p.prs.length) links.push(`PR: ${p.prs.join(' ')}`);
    else if (plan.intents.has('pr') || plan.intents.has('missingPr')) links.push('PR: nenhum link salvo');
    if (links.length) lines.push(`   ${links.join(' · ')}`);
    if (/^comece por aqui$/i.test(p.title)) lines.push('   (pagina de boas-vindas criada pelo app)');

    if (plan.intents.has('files') && i === 0) {
      const files = filesOf(p);
      if (files.length) lines.push(`   Arquivos/componentes citados: ${files.join(', ')}`);
    }
    if (size) {
      for (const s of snippets(p, plan, i === 0 ? 3 : 1, size, index)) lines.push(`   › ${s}`);
    }
  });
  if (total > results.length) lines.push('', `(+${total - results.length} resultado(s) nao mostrado(s))`);

  let out = lines.join('\n');
  if (out.length > MAX_CHARS) out = `${out.slice(0, MAX_CHARS)}\n… (cortado no limite de ${MAX_CHARS} caracteres)`;
  return out;
}

export function breadcrumb(page) {
  const parts = [];
  for (let a = page.parent; a; a = a.parent) parts.unshift(a.title || 'Sem titulo');
  return parts.join(' › ');
}

/* --------------------------------- util ------------------------------------ */

function localDate(sqlite) {
  if (!sqlite) return 0;
  return Date.parse(`${sqlite.replace(' ', 'T')}Z`) + TZ_OFFSET_H * 3600000;
}

function startOfDay(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function fmt(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const unique = (a) => [...new Set(a)];

function count(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
