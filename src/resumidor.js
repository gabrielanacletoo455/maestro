// Le as conversas do Claude Code (~/.claude/projects/*/*.jsonl), separa o que e novo,
// pede um resumo ao Haiku (`claude -p --model haiku`) e grava com o registro.
//
// Dois modos:
//  - continuo: a cada 30 min, resume o que aconteceu desde a ultima vez (so conversas novas
//    a partir da instalacao; o historico antigo so entra pela importacao).
//  - importacao: fila de conversas antigas escolhidas pelo dev, processadas devagar
//    (poucas por hora), indo para uma PREVIA que o dev aprova antes de virar nota.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir, tmpdir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { registrar, tipoPelaBranch, MODELO_TASK, MODELO_CHAMADO } from './registro.js';
import { limparTudo } from './sensivel.js';
import { pages, blocks } from './repo.js';
import { db } from './db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_ESTADO = process.env.MAESTRO_ESTADO_DIR ?? join(ROOT, 'data', 'maestro');
const ARQ_ESTADO = join(PASTA_ESTADO, 'estado.json');
const PROJETOS = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
const CWD_RESUMO = join(tmpdir(), 'maestro-resumidor');

const MIN = 60000;
const INTERVALO_CONTINUO = 30 * MIN;
const INTERVALO_FILA = 5 * MIN;
const IMPORTACAO_POR_HORA = Number(process.env.MAESTRO_IMPORTACAO_POR_HORA ?? 5);
const OCIOSA_MS = 20 * MIN;           // conversa parada ha 20 min ja pode ser resumida
const MAX_CHARS = 45000;              // corte do texto mandado ao Haiku (~12k tokens)
const MIN_CHARS = 1500;

/* --------------------------------- estado ---------------------------------- */

function lerEstado() {
  try {
    return JSON.parse(readFileSync(ARQ_ESTADO, 'utf8'));
  } catch {
    return null;
  }
}

function salvarEstado(e) {
  mkdirSync(PASTA_ESTADO, { recursive: true });
  writeFileSync(ARQ_ESTADO, JSON.stringify(e, null, 2));
}

function estado() {
  let e = lerEstado();
  if (!e) {
    // Primeira vez: marca tudo que ja existe como "lido". O passado so entra pela importacao.
    e = { versao: 1, iniciadoEm: Date.now(), arquivos: {}, fila: [], pendentes: [], pausaAte: 0, hora: { inicio: 0, feitas: 0 }, ultimoErro: null };
    for (const arq of listarConversas()) e.arquivos[arq.caminho] = { offset: arq.tamanho };
    salvarEstado(e);
  }
  return e;
}

/* ------------------------------ ler conversas ------------------------------ */

export function listarConversas() {
  if (!existsSync(PROJETOS)) return [];
  const out = [];
  for (const projeto of readdirSync(PROJETOS)) {
    if (projeto.includes('maestro-resumidor')) continue;
    const pasta = join(PROJETOS, projeto);
    let nomes = [];
    try { nomes = readdirSync(pasta); } catch { continue; }
    for (const nome of nomes) {
      if (!nome.endsWith('.jsonl')) continue;
      const caminho = join(pasta, nome);
      try {
        const st = statSync(caminho);
        out.push({ caminho, projeto, tamanho: st.size, modificado: st.mtimeMs });
      } catch {}
    }
  }
  return out;
}

function lerDesde(caminho, offset) {
  const tamanho = statSync(caminho).size;
  if (tamanho <= offset) return { linhas: [], fim: offset };
  const fd = openSync(caminho, 'r');
  const buf = Buffer.alloc(tamanho - offset);
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  const txt = buf.toString('utf8');
  const ultimaQuebra = txt.lastIndexOf('\n');
  if (ultimaQuebra < 0) return { linhas: [], fim: offset };
  return { linhas: txt.slice(0, ultimaQuebra).split('\n'), fim: offset + Buffer.byteLength(txt.slice(0, ultimaQuebra + 1)) };
}

const LIMPAR_USUARIO = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g,
  /<command-[\w-]+>[\s\S]*?<\/command-[\w-]+>/g,
  /<local-command-[\w-]+>[\s\S]*?<\/local-command-[\w-]+>/g,
];

function textoDoUsuario(conteudo) {
  let t = typeof conteudo === 'string'
    ? conteudo
    : Array.isArray(conteudo)
      ? conteudo.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      : '';
  for (const re of LIMPAR_USUARIO) t = t.replace(re, ' ');
  return t.trim();
}

function resumoDeFerramenta(b) {
  const i = b.input ?? {};
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(b.name)) return `[${b.name} ${i.file_path ?? ''}]`;
  if (b.name === 'Bash') return `[Bash: ${String(i.command ?? '').slice(0, 100)}]`;
  return null;
}

/** Transforma linhas do .jsonl em trechos por (cwd, branch), so com o que importa. */
function extrairTrechos(linhas) {
  const trechos = [];
  let atual = null;
  for (const linha of linhas) {
    let o;
    try { o = JSON.parse(linha); } catch { continue; }
    if (o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) continue;
    const branch = o.gitBranch && o.gitBranch !== 'HEAD' ? o.gitBranch : '';
    const cwd = o.cwd ?? '';
    if (!atual || atual.branch !== branch || atual.cwd !== cwd) {
      atual = { branch, cwd, partes: [], usuario: 0, inicio: o.timestamp, fim: o.timestamp, sessao: o.sessionId };
      trechos.push(atual);
    }
    atual.fim = o.timestamp ?? atual.fim;
    const c = o.message?.content;
    if (o.type === 'user') {
      if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) continue;
      const t = textoDoUsuario(c);
      if (t.length < 2) continue;
      atual.usuario += 1;
      atual.partes.push(`DEV: ${t.slice(0, 3000)}`);
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text' && b.text.trim()) atual.partes.push(`CLAUDE: ${b.text.trim().slice(0, 2500)}`);
        else if (b.type === 'tool_use') {
          const r = resumoDeFerramenta(b);
          if (r) atual.partes.push(`CLAUDE ${r}`);
        }
      }
    }
  }
  return trechos
    .map((t) => {
      let texto = t.partes.join('\n');
      if (texto.length > MAX_CHARS) texto = `${texto.slice(0, 5000)}\n[... trecho do meio omitido ...]\n${texto.slice(-(MAX_CHARS - 5000))}`;
      return { ...t, texto };
    })
    .filter((t) => t.usuario >= 2 && t.texto.length >= MIN_CHARS);
}

/* --------------------------------- o Haiku --------------------------------- */

function promptDeResumo(trecho) {
  const tipo = tipoPelaBranch(trecho.branch);
  const modelo = tipo === 'chamado' ? MODELO_CHAMADO : MODELO_TASK;
  const secoes = modelo.map((s) => `    "${s.chave}": ${s.chave === 'feito' ? '{ "titulo": "", "itens": [] }' : '[]'}   // ${s.titulo}`).join(',\n');
  return `Voce e o registrador do Maestro, a memoria local de um desenvolvedor. Abaixo esta um trecho
de conversa entre o DEV e o CLAUDE (Claude Code). Extraia SO o que vale lembrar no futuro.

Projeto: ${basename(trecho.cwd) || 'desconhecido'} · Branch: ${trecho.branch || 'nenhuma'} · Tipo de anotacao: ${tipo}

Regras:
- So FATOS que aparecem na conversa: decisoes tomadas, o que alguem disse (com nome e data se houver),
  causa e correcao de bug, regras de negocio, contratos de API, permissoes, arquivos/componentes criados,
  pendencias que ficaram abertas, licoes aprendidas.
- Se algo foi decidido e depois mudou, registre so a versao FINAL.
- Descarte tentativas que falharam, especulacao, conversa sem conclusao, detalhes de ferramenta.
- NUNCA inclua senhas, tokens, chaves, CPF, CNPJ, e-mail, telefone ou dados de cliente.
- Itens curtos (ate ~250 caracteres), em portugues, sem markdown alem de \`codigo\`.
- Secao sem nada: lista vazia. Se a conversa toda nao tiver nada que valha lembrar, responda
  {"relevante": false}.

Responda APENAS com JSON valido neste formato:
{
  "relevante": true,
  "titulo": "nome curto da task/assunto",
  "resumo": "1 a 2 frases do que foi feito nesta conversa",
  "secoes": {
${secoes}
  },
  "palavras": ["5 a 10 palavras-chave para busca futura"]
}

Conversa:
"""
${trecho.texto}
"""`;
}

function acharClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const exe = platform() === 'win32' ? 'claude.exe' : 'claude';
  for (const p of [join(homedir(), '.local', 'bin', exe), '/usr/local/bin/claude', '/opt/homebrew/bin/claude']) {
    if (existsSync(p)) return p;
  }
  return 'claude';
}

/** Chama o resumidor. MAESTRO_RESUMIDOR_CMD troca o comando (usado nos testes). */
function chamarHaiku(prompt) {
  return new Promise((resolve, reject) => {
    const custom = process.env.MAESTRO_RESUMIDOR_CMD;
    const [cmd, args] = custom ? [process.execPath, [custom]] : [acharClaude(), ['-p', '--model', 'haiku', '--max-turns', '1']];
    mkdirSync(CWD_RESUMO, { recursive: true });
    const filho = spawn(cmd, args, {
      cwd: CWD_RESUMO,
      env: { ...process.env, MAESTRO_RESUMO: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => filho.kill(), 3 * MIN);
    filho.stdout.on('data', (d) => (out += d));
    filho.stderr.on('data', (d) => (err += d));
    filho.on('error', (e) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`nao consegui rodar o Claude (${e.message}). Ele esta instalado?`), { tipo: 'sem-claude' }));
    });
    filho.on('close', (codigo) => {
      clearTimeout(timer);
      const tudo = `${out}\n${err}`;
      if (/not logged in|please run \/login/i.test(tudo)) {
        return reject(Object.assign(new Error('o Claude de terminal nao esta logado: rode `claude` e faca /login'), { tipo: 'login' }));
      }
      if (/usage limit|rate limit|limit reached|limite de uso/i.test(tudo)) {
        return reject(Object.assign(new Error('limite de uso do plano atingido; pausando'), { tipo: 'limite' }));
      }
      if (codigo !== 0) return reject(new Error(`o Claude terminou com codigo ${codigo}: ${tudo.trim().slice(0, 300)}`));
      const ini = out.indexOf('{');
      const fim = out.lastIndexOf('}');
      if (ini < 0 || fim < ini) return reject(new Error('o resumo nao veio em JSON'));
      try {
        resolve(JSON.parse(out.slice(ini, fim + 1)));
      } catch (e) {
        reject(new Error(`JSON invalido no resumo: ${e.message}`));
      }
    });
    filho.stdin.end(prompt);
  });
}

/* ------------------------------ modo continuo ------------------------------ */

let ocupado = false;

function autorGit(cwd) {
  if (process.env.MAESTRO_AUTOR) return process.env.MAESTRO_AUTOR;
  try {
    return execFileSync('git', ['-C', cwd || '.', 'config', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
  } catch {
    return '';
  }
}

function contextoDe(trecho) {
  return {
    branch: trecho.branch,
    projeto: basename(trecho.cwd),
    autor: autorGit(trecho.cwd),
    quando: Date.parse(trecho.fim) || Date.now(),
    sessao: trecho.sessao,
  };
}

function tratarErro(e, err) {
  e.ultimoErro = { em: Date.now(), mensagem: err.message };
  if (err.tipo === 'limite') e.pausaAte = Date.now() + 60 * MIN;
  if (err.tipo === 'login' || err.tipo === 'sem-claude') e.pausaAte = Date.now() + 30 * MIN;
  console.error(`  maestro resumidor: ${err.message}`);
}

export async function rodarContinuo({ forcar = false } = {}) {
  if (ocupado) return { ok: false, motivo: 'ocupado' };
  ocupado = true;
  const e = estado();
  const feitos = [];
  try {
    if (!forcar && e.pausaAte > Date.now()) return { ok: false, motivo: 'pausado', ate: e.pausaAte };
    for (const arq of listarConversas()) {
      const info = e.arquivos[arq.caminho] ?? { offset: 0 };
      if (arq.tamanho <= info.offset) continue;
      const ocioso = Date.now() - arq.modificado > OCIOSA_MS;
      const muito = arq.tamanho - info.offset > 400000;
      if (!ocioso && !muito && !forcar) continue;

      const { linhas, fim } = lerDesde(arq.caminho, info.offset);
      const trechos = extrairTrechos(linhas);
      for (const t of trechos) {
        const resumo = await chamarHaiku(promptDeResumo(t));
        feitos.push(registrar(resumo, contextoDe(t)));
      }
      e.arquivos[arq.caminho] = { offset: fim };
      salvarEstado(e);
    }
    e.ultimoErro = null;
    return { ok: true, feitos };
  } catch (err) {
    tratarErro(e, err);
    return { ok: false, motivo: err.message };
  } finally {
    salvarEstado(e);
    ocupado = false;
  }
}

/* ------------------------------- importacao -------------------------------- */

/** Conversas antigas que podem ser importadas, com estimativa de tokens. */
export function candidatosImportacao({ dias = null, projetos = null } = {}) {
  const e = estado();
  const limite = dias ? Date.now() - dias * 24 * 60 * MIN : 0;
  const lista = [];
  for (const arq of listarConversas()) {
    if (arq.modificado < limite) continue;
    if (projetos && !projetos.some((p) => arq.projeto.toLowerCase().includes(p.toLowerCase()))) continue;
    if (e.fila.includes(arq.caminho) || (e.jaImportados ?? []).includes(arq.caminho)) continue;
    const ate = e.arquivos[arq.caminho]?.offset ?? arq.tamanho;
    let linhas = [];
    try { linhas = lerDesde(arq.caminho, 0).linhas; } catch { continue; }
    const trechos = extrairTrechos(linhas);
    if (!trechos.length) continue;
    const chars = trechos.reduce((s, t) => s + t.texto.length, 0);
    lista.push({ arquivo: arq.caminho, projeto: arq.projeto, modificado: arq.modificado, trechos: trechos.length, tokens: Math.round(chars / 3.5) + trechos.length * 900, ate });
  }
  return lista.sort((a, b) => b.modificado - a.modificado);
}

export function iniciarImportacao(arquivos) {
  const e = estado();
  for (const a of arquivos) if (!e.fila.includes(a)) e.fila.push(a);
  salvarEstado(e);
  return { naFila: e.fila.length };
}

export function cancelarImportacao() {
  const e = estado();
  const n = e.fila.length;
  e.fila = [];
  salvarEstado(e);
  return { removidos: n };
}

async function processarUmaDaFila(e) {
  const arquivo = e.fila[0];
  const ate = e.arquivos[arquivo]?.offset;
  let linhas = [];
  try { linhas = lerDesde(arquivo, 0).linhas; } catch {}
  // So o que ja existia antes da escrita continua (o resto o modo continuo cuida).
  if (ate !== undefined) {
    const corte = [];
    let bytes = 0;
    for (const l of linhas) {
      bytes += Buffer.byteLength(l) + 1;
      if (bytes > ate) break;
      corte.push(l);
    }
    linhas = corte;
  }
  for (const t of extrairTrechos(linhas)) {
    const bruto = await chamarHaiku(promptDeResumo(t));
    if (bruto.relevante === false) continue;
    const { valor } = limparTudo(bruto);
    e.pendentes.push({ id: `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, arquivo, resumo: valor, contexto: contextoDe(t) });
  }
  e.fila.shift();
  e.hora.feitas += 1;
  e.importadas = (e.importadas ?? 0) + 1;
  e.jaImportados = [...new Set([...(e.jaImportados ?? []), arquivo])];
}

export async function rodarFila({ max = null } = {}) {
  if (ocupado) return { ok: false, motivo: 'ocupado' };
  ocupado = true;
  const e = estado();
  let feitas = 0;
  try {
    while (e.fila.length) {
      if (max !== null && feitas >= max) break;
      if (max === null) {
        if (e.pausaAte > Date.now()) break;
        if (Date.now() - e.hora.inicio > 60 * MIN) e.hora = { inicio: Date.now(), feitas: 0 };
        if (e.hora.feitas >= IMPORTACAO_POR_HORA) break;
      }
      await processarUmaDaFila(e);
      feitas += 1;
      salvarEstado(e);
    }
    atualizarPrevia(e);
    return { ok: true, feitas, faltam: e.fila.length, pendentes: e.pendentes.filter((p) => !p.aplicado && !p.descartado).length };
  } catch (err) {
    tratarErro(e, err);
    return { ok: false, motivo: err.message, feitas };
  } finally {
    salvarEstado(e);
    ocupado = false;
  }
}

/* ---------------------------- previa e aprovacao --------------------------- */

const TITULO_PREVIA = '📥 Importação (para revisar)';

function atualizarPrevia(e) {
  const abertos = e.pendentes.filter((p) => !p.aplicado && !p.descartado);
  let id = e.previaId && db.prepare('SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL').get(e.previaId)?.id;
  if (!abertos.length) return;
  if (!id) {
    id = pages.create({ title: TITULO_PREVIA, icon: '📥' }).id;
    e.previaId = id;
  }
  const lista = [];
  lista.push({ type: 'callout', content: 'Resumos das conversas antigas, feitos pelo Claude. Nada disto esta nas suas paginas ainda. Para aprovar rode <code>maestro importar aprovar</code> (todos) ou <code>maestro importar aprovar 1,3</code>; para descartar, <code>maestro importar descartar 2</code>.', props: { emoji: '📥' } });
  abertos.forEach((p, i) => {
    const c = p.contexto;
    const data = new Date(c.quando - 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    lista.push({ type: 'heading2', content: `${i + 1}. ${esc(p.resumo.titulo || 'Sem titulo')}` });
    lista.push({ type: 'paragraph', content: `<i>${esc(`${data} · ${c.projeto} · ${c.branch || 'sem branch'} → vai para: ${tipoPelaBranch(c.branch) === 'diario' ? 'Diário' : 'página da task'}`)}</i>` });
    if (p.resumo.resumo) lista.push({ type: 'paragraph', content: esc(p.resumo.resumo) });
    for (const [chave, v] of Object.entries(p.resumo.secoes ?? {})) {
      const itens = chave === 'feito' ? v?.itens ?? [] : Array.isArray(v) ? v : [];
      for (const item of itens) lista.push({ type: 'bulleted', content: `<b>${esc(chave)}:</b> ${esc(item)}` });
    }
  });
  blocks.replaceAll(id, lista);
}

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function pendentesAbertos() {
  return estado().pendentes.filter((p) => !p.aplicado && !p.descartado);
}

function escolher(e, indices) {
  const abertos = e.pendentes.filter((p) => !p.aplicado && !p.descartado);
  if (indices === 'todos') return abertos;
  return indices
    .map((x) => (typeof x === 'string' ? abertos.find((p) => p.id === x) : abertos[x - 1]))
    .filter(Boolean);
}

export function aprovar(indices = 'todos') {
  const e = estado();
  const escolhidos = escolher(e, indices);
  const resultados = escolhidos.map((p) => {
    const r = registrar(p.resumo, p.contexto);
    p.aplicado = Date.now();
    return { titulo: p.resumo.titulo, ...r };
  });
  fecharPreviaSeVazia(e);
  salvarEstado(e);
  return resultados;
}

export function descartar(indices) {
  const e = estado();
  const escolhidos = escolher(e, indices);
  for (const p of escolhidos) p.descartado = Date.now();
  fecharPreviaSeVazia(e);
  salvarEstado(e);
  return { descartados: escolhidos.length };
}

function fecharPreviaSeVazia(e) {
  if (e.pendentes.some((p) => !p.aplicado && !p.descartado)) return atualizarPrevia(e);
  if (e.previaId) pages.remove(e.previaId); // vai para a lixeira, nao e apagada de vez
  e.previaId = null;
}

export function status() {
  const e = estado();
  const erro = e.ultimoErro;
  return {
    iniciadoEm: e.iniciadoEm,
    pausaAte: e.pausaAte > Date.now() ? e.pausaAte : null,
    ultimoErro: erro,
    precisaLogin: Boolean(erro && /nao esta logado|nao consegui rodar o Claude/.test(erro.mensagem)),
    fila: e.fila.length,
    importadas: e.importadas ?? 0,
    pendentes: e.pendentes.filter((p) => !p.aplicado && !p.descartado).length,
    porHora: IMPORTACAO_POR_HORA,
    importacaoPerguntada: Boolean(e.importacaoPerguntada),
  };
}

/* ------------------------- primeira vez: perguntar ------------------------- */

let cacheCandidatos = null;

function candidatosComCache() {
  if (!cacheCandidatos || Date.now() - cacheCandidatos.em > 10 * MIN) {
    cacheCandidatos = { em: Date.now(), lista: candidatosImportacao() };
  }
  return cacheCandidatos.lista;
}

/** O que o app precisa para perguntar, na primeira vez, se o dev quer importar o historico. */
export function boasVindas() {
  const e = estado();
  const lista = candidatosComCache();
  const mes = Date.now() - 30 * 24 * 60 * MIN;
  const recentes = lista.filter((c) => c.modificado >= mes);
  const soma = (l) => l.reduce((s, c) => s + c.tokens, 0);
  return {
    perguntar: !e.importacaoPerguntada && lista.length > 0,
    todas: { conversas: lista.length, tokens: soma(lista) },
    recentes: { conversas: recentes.length, tokens: soma(recentes) },
    porHora: IMPORTACAO_POR_HORA,
  };
}

export function responderImportacao(escolha) {
  const e = estado();
  e.importacaoPerguntada = Date.now();
  e.escolhaImportacao = escolha;
  salvarEstado(e);
  if (escolha !== 'todas' && escolha !== 'recentes') return { naFila: e.fila.length };
  const lista = candidatosComCache();
  const mes = Date.now() - 30 * 24 * 60 * MIN;
  const escolhidas = escolha === 'recentes' ? lista.filter((c) => c.modificado >= mes) : lista;
  const r = iniciarImportacao(escolhidas.map((c) => c.arquivo));
  cacheCandidatos = null;
  setTimeout(() => rodarFila().catch(() => {}), 1000).unref?.();
  return r;
}

/* --------------------------------- agenda ---------------------------------- */

export function iniciarResumidor() {
  if (process.env.MAESTRO_ESCRITA === '0') return;
  estado();
  const t1 = setInterval(() => rodarContinuo().catch(() => {}), INTERVALO_CONTINUO);
  const t2 = setInterval(() => rodarFila().catch(() => {}), INTERVALO_FILA);
  t1.unref?.();
  t2.unref?.();
  setTimeout(() => rodarContinuo().catch(() => {}), 2 * MIN).unref?.();
}
