// Escrita automatica: grava um resumo de conversa (feito pelo Haiku) nas notas.
// Regras: so ACRESCENTA, nunca edita nem apaga bloco existente; tudo passa pelo filtro
// de dados sensiveis; backup antes; cada acrescimo leva a marca do Claude com data e hora.
//
// Destino:
//  - branch feature/<id>-...        -> pagina da task (modelo "task")
//  - branch bugfix|hotfix/<id>-...  -> pagina do chamado (modelo "chamado"), em "Bugs da sprint"
//  - qualquer outra coisa           -> so o Diario do dia
// Toda sessao tambem ganha uma entrada curta no Diario (pagina por dia), com link para a task.

import { db } from './db.js';
import { pages, blocks } from './repo.js';
import { limparTudo } from './sensivel.js';
import { backupNow } from './backup.js';
import { scheduleMirror } from './mirror.js';

const APP = `http://localhost:${process.env.PORT ?? 4321}`;
const TZ_H = -3;

/* --------------------------------- modelos --------------------------------- */

// chave do resumo -> titulo da secao, como reconhecer numa pagina existente, se aparece sempre
export const MODELO_TASK = [
  { chave: 'descricao', titulo: 'Descrição da task (ClickUp)', re: /^descric/, sempre: true },
  { chave: 'codigo', titulo: 'Onde as coisas ficam no código', re: /onde as coisas|no codigo/, sempre: true },
  { chave: 'commits', titulo: 'Commits da branch', re: /commits/ },
  { chave: 'permissoes', titulo: 'Permissões', re: /^permiss/ },
  { chave: 'feito', titulo: 'O que foi feito e por quê', re: /o que foi feito/, sempre: true },
  { chave: 'figma', titulo: 'Figma', re: /figma/ },
  { chave: 'conversas', titulo: 'Conversas com a equipe', re: /convers/, sempre: true },
  { chave: 'backend', titulo: 'Documentação do backend', re: /documentac|backend/ },
  { chave: 'duvidas', titulo: 'Dúvidas em aberto', re: /duvida/, sempre: true },
  { chave: 'pendencias', titulo: 'Pendências', re: /pendenc/, sempre: true },
  { chave: 'licoes', titulo: 'Lições desta task', re: /lico/, sempre: true },
  { chave: 'review', titulo: 'Review do código', re: /review/ },
];

export const MODELO_CHAMADO = [
  { chave: 'descricao', titulo: 'Descrição do chamado', re: /^descric/, sempre: true },
  { chave: 'historico', titulo: 'Histórico (ClickUp)', re: /historico/, sempre: true },
  { chave: 'validacao', titulo: 'Validação do dev', re: /validac/, sempre: true },
  { chave: 'resolucao', titulo: 'Resolução', re: /resoluc|causa|correc/, sempre: true },
  { chave: 'pendencias', titulo: 'Pendências', re: /pendenc/, sempre: true },
];

export function tipoPelaBranch(branch = '') {
  if (/^(bugfix|fix|hotfix)\//i.test(branch)) return 'chamado';
  if (/^(feature|feat)\//i.test(branch)) return 'task';
  return 'diario';
}

const idDaBranch = (branch = '') =>
  branch.match(/^[\w-]+\/([a-z0-9]{6,12})-/i)?.[1]?.toLowerCase() ?? null;

/* ---------------------------------- util ----------------------------------- */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const texto = (html) =>
  String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function html(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

const link = (url, rotulo) => `<a href="${url}">${html(rotulo)}</a>`;

function agoraLocal(ms = Date.now()) {
  const d = new Date(ms + TZ_H * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    dia: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    data: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    hora: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

/* --------------------------------- paginas --------------------------------- */

function paginasVivas() {
  return db.prepare('SELECT id, parent_id, title FROM pages WHERE deleted_at IS NULL').all().map((r) => ({ ...r }));
}

function primeirosBlocos(pageId, n = 6) {
  return db
    .prepare('SELECT content FROM blocks WHERE page_id = ? ORDER BY position, created_at LIMIT ?')
    .all(pageId, n)
    .map((b) => norm(texto(b.content)));
}

export function acharPaginaDaTask(branch) {
  const id = idDaBranch(branch);
  if (!id) return null;
  const branchN = norm(branch);
  const candidatos = db
    .prepare(
      `SELECT DISTINCT p.id, p.title FROM pages p JOIN blocks b ON b.page_id = p.id
       WHERE p.deleted_at IS NULL AND (b.content LIKE ? OR p.title LIKE ?)`
    )
    .all(`%${id}%`, `%${id}%`)
    .map((r) => ({ ...r }));
  for (const c of candidatos) if (primeirosBlocos(c.id).some((t) => t.includes(branchN))) return c.id;
  const cabecalho = new RegExp(`(task|chamado) clickup\\W+${id}\\b`);
  for (const c of candidatos) if (primeirosBlocos(c.id).some((t) => cabecalho.test(t))) return c.id;
  return candidatos.find((c) => norm(c.title).includes(id))?.id ?? null;
}

function sprintAtual() {
  const hoje = Date.parse(`${agoraLocal().dia}T00:00:00Z`);
  const sprints = paginasVivas()
    .filter((p) => /^sprint\b/i.test(p.title))
    .map((p) => {
      const m = p.title.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      return { ...p, data: m ? Date.UTC(2000 + (+m[3] % 100), +m[2] - 1, +m[1]) : 0 };
    })
    .sort((a, b) => a.data - b.data);
  return sprints.find((s) => s.data >= hoje) ?? sprints.at(-1) ?? null;
}

function filhaOuCria(parentId, re, titulo, icone = '') {
  const achada = paginasVivas().find((p) => p.parent_id === parentId && re.test(norm(p.title)));
  if (achada) return achada.id;
  return pages.create({ parentId, title: titulo, icon: icone }).id;
}

function raizOuCria(re, titulo, icone) {
  return filhaOuCria(null, re, titulo, icone);
}

/** Cria a pagina nova seguindo o modelo, com o cabecalho e as secoes. Devolve o id. */
function criarPagina(resumo, contexto) {
  const tipo = contexto.tipo;
  const sprint = sprintAtual();
  let pai = sprint?.id ?? raizOuCria(/^tasks$/, 'Tasks', '🗂️');
  if (tipo === 'chamado') pai = filhaOuCria(pai, /^bugs/, 'Bugs da sprint', '⚠️');

  const titulo = String(resumo.titulo || contexto.branch.replace(/^[\w-]+\/[a-z0-9]{6,12}-/i, '').replace(/-/g, ' ')).slice(0, 140);
  const pagina = pages.create({ parentId: pai, title: titulo });
  const id = idDaBranch(contexto.branch);
  const { data } = agoraLocal(contexto.quando);
  const cabecalho =
    tipo === 'chamado'
      ? `Chamado ClickUp ${id ?? ''} · Responsável: ${contexto.autor || '—'}<br>Branch: <code>${html(contexto.branch)}</code> · 🤖 página criada pelo Claude em ${data}`
      : `Task ClickUp ${id ?? ''} · ${sprint ? html(sprint.title) : 'sem sprint'} · Responsável: ${contexto.autor || '—'}<br>Branch: <code>${html(contexto.branch)}</code> · 🤖 página criada pelo Claude em ${data}`;

  const primeiro = pagina.blocks[0].id;
  blocks.update(primeiro, { type: 'quote', content: cabecalho });
  let ultimo = blocks.create(pagina.id, { afterId: primeiro, type: 'divider' }).id;

  const modelo = tipo === 'chamado' ? MODELO_CHAMADO : MODELO_TASK;
  let n = 0;
  for (const sec of modelo) {
    const itens = itensDaSecao(resumo, sec.chave);
    if (!sec.sempre && !itens.length) continue;
    n += 1;
    ultimo = blocks.create(pagina.id, { afterId: ultimo, type: 'heading2', content: html(`${n}. ${sec.titulo}`) }).id;
  }
  return pagina.id;
}

/* --------------------------------- secoes ---------------------------------- */

function itensDaSecao(resumo, chave) {
  const v = resumo.secoes?.[chave];
  if (chave === 'feito') return v && lista(v.itens).length ? lista(v.itens) : [];
  return lista(v);
}

function blocosDaPagina(pageId) {
  return db
    .prepare('SELECT id, type, content, props FROM blocks WHERE page_id = ? ORDER BY position, created_at')
    .all(pageId)
    .map((b) => ({ ...b, txt: norm(texto(b.content)).replace(/^[\d.\s]+/, '') }));
}

/** Ultimo bloco da secao (antes do proximo heading1/heading2). */
function fimDaSecao(lista, i) {
  let fim = i;
  for (let j = i + 1; j < lista.length; j++) {
    if (lista[j].type === 'heading1' || lista[j].type === 'heading2') break;
    fim = j;
  }
  return lista[fim].id;
}

function inserirItens(pageId, depoisDe, chave, itens, marca, tituloFeito) {
  let ultimo = blocks.create(pageId, { afterId: depoisDe, type: 'paragraph', content: `<i>${html(marca)}</i>` }).id;
  if (chave === 'feito' && tituloFeito) {
    ultimo = blocks.create(pageId, { afterId: ultimo, type: 'heading3', content: html(tituloFeito) }).id;
  }
  const tipo = chave === 'pendencias' ? 'todo' : chave === 'conversas' ? 'quote' : 'bulleted';
  for (const item of itens) ultimo = blocks.create(pageId, { afterId: ultimo, type: tipo, content: html(item) }).id;
  return ultimo;
}

function acrescentarNaPagina(pageId, resumo, contexto) {
  const modelo = contexto.tipo === 'chamado' ? MODELO_CHAMADO : MODELO_TASK;
  const { data, hora } = agoraLocal(contexto.quando);
  const marca = `🤖 Claude · ${data} ${hora}`;
  let inseridos = 0;

  const conhecidas = blocosDaPagina(pageId).filter(
    (b) => (b.type === 'heading1' || b.type === 'heading2') && modelo.some((s) => s.re.test(b.txt))
  );

  // Pagina sem o padrao (anotacao antiga, solta): tudo junto numa secao nova no fim.
  if (conhecidas.length < 2) {
    const todos = blocosDaPagina(pageId);
    let ultimo = blocks.create(pageId, { afterId: todos.at(-1)?.id ?? null, type: 'heading2', content: html(`🤖 Sessão ${data} ${hora} (Claude)`) }).id;
    if (resumo.resumo) ultimo = blocks.create(pageId, { afterId: ultimo, type: 'paragraph', content: html(resumo.resumo) }).id;
    for (const sec of modelo) {
      const itens = itensDaSecao(resumo, sec.chave);
      if (!itens.length) continue;
      ultimo = blocks.create(pageId, { afterId: ultimo, type: 'paragraph', content: `<b>${html(sec.titulo)}</b>` }).id;
      for (const item of itens) {
        ultimo = blocks.create(pageId, { afterId: ultimo, type: sec.chave === 'pendencias' ? 'todo' : 'bulleted', content: html(item) }).id;
        inseridos += 1;
      }
    }
    return inseridos;
  }

  for (const sec of modelo) {
    const itens = itensDaSecao(resumo, sec.chave);
    if (!itens.length) continue;
    const atual = blocosDaPagina(pageId);
    const i = atual.findIndex((b) => (b.type === 'heading1' || b.type === 'heading2') && sec.re.test(b.txt));
    const tituloFeito = sec.chave === 'feito' ? `🤖 ${data} — ${resumo.secoes.feito.titulo || 'sessão com o Claude'}` : null;
    if (i >= 0) {
      inserirItens(pageId, fimDaSecao(atual, i), sec.chave, itens, marca, tituloFeito);
    } else {
      const fim = blocks.create(pageId, { afterId: atual.at(-1).id, type: 'heading2', content: html(sec.titulo) }).id;
      inserirItens(pageId, fim, sec.chave, itens, marca, tituloFeito);
    }
    inseridos += itens.length;
  }
  return inseridos;
}

function entradaNoDiario(resumo, contexto, paginaTask) {
  const { dia, hora } = agoraLocal(contexto.quando);
  const diario = raizOuCria(/^diario$/, 'Diário', '📓');
  const hojeId = filhaOuCria(diario, new RegExp(`^${dia}$`), dia, '🗓️');
  const atual = blocosDaPagina(hojeId);
  const depois = atual.at(-1)?.id ?? null;
  const onde = [contexto.projeto, contexto.branch].filter(Boolean).join(' · ');
  let ultimo = blocks.create(hojeId, { afterId: depois, type: 'heading3', content: html(`🤖 ${hora} · ${onde || 'conversa'}`) }).id;
  if (resumo.resumo) ultimo = blocks.create(hojeId, { afterId: ultimo, type: 'paragraph', content: html(resumo.resumo) }).id;
  if (paginaTask) {
    const t = db.prepare('SELECT title FROM pages WHERE id = ?').get(paginaTask)?.title ?? 'task';
    ultimo = blocks.create(hojeId, { afterId: ultimo, type: 'paragraph', content: `Task: ${link(`${APP}/#${paginaTask}`, t)}` }).id;
  } else {
    for (const sec of MODELO_TASK) {
      for (const item of itensDaSecao(resumo, sec.chave).slice(0, 4)) {
        ultimo = blocks.create(hojeId, { afterId: ultimo, type: sec.chave === 'pendencias' ? 'todo' : 'bulleted', content: html(item) }).id;
      }
    }
  }
  const palavras = lista(resumo.palavras).slice(0, 12);
  if (palavras.length) {
    blocks.create(hojeId, { afterId: ultimo, type: 'paragraph', content: `<i>Palavras-chave: ${html(palavras.map((p) => `#${p.replace(/\s+/g, '-')}`).join(' '))}</i>` });
  }
  return hojeId;
}

/* ---------------------------------- entrada -------------------------------- */

/**
 * resumo: { relevante, titulo, resumo, secoes: {...}, palavras: [] }
 * contexto: { branch, projeto, autor, quando (ms), sessao }
 */
export function registrar(resumoBruto, contextoBruto = {}) {
  if (!resumoBruto || resumoBruto.relevante === false) return { gravado: false, motivo: 'nada relevante' };
  const { valor: resumo, removidos } = limparTudo(resumoBruto);
  const contexto = { ...contextoBruto, quando: contextoBruto.quando ?? Date.now() };
  contexto.tipo = tipoPelaBranch(contexto.branch);

  backupNow('maestro');

  let paginaTask = null;
  let inseridos = 0;
  let criada = false;
  if (contexto.tipo !== 'diario') {
    paginaTask = acharPaginaDaTask(contexto.branch);
    if (!paginaTask) {
      paginaTask = criarPagina(resumo, contexto);
      criada = true;
    }
    inseridos = acrescentarNaPagina(paginaTask, resumo, contexto);
  }
  const diario = entradaNoDiario(resumo, contexto, paginaTask);
  scheduleMirror();
  return { gravado: true, paginaTask, criada, diario, inseridos, sensiveisRemovidos: removidos };
}
