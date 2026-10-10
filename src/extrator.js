// Resumidor local, SEM IA: le um trecho de conversa (DEV x CLAUDE + ferramentas usadas) e
// extrai por regras o que vale guardar. Devolve o mesmo formato que o resumo do Haiku teria,
// entao o registro (src/registro.js) nao precisa saber quem resumiu.
//
// Sinais usados, do mais confiavel para o menos:
//  1. ferramentas: arquivos editados/criados, mensagens de commit         (fato puro)
//  2. frases com marcadores fortes: "Causa:", "Correcao:", "Decisao:",
//     "Pendente", endpoints HTTP, permissoes em camelCase                  (quase fato)
//  3. o resumo final do Claude: bullets com verbo no passado ("criei", "troquei")
//  4. falas de colegas citadas pelo dev ("o Vagner disse...", "Kaio: ...")
// Mensagens mais recentes ganham: se algo mudou no meio da conversa, fica a versao final.


function tipoPelaBranch(branch = '') {
  if (/^(bugfix|fix|hotfix)\//i.test(branch)) return 'chamado';
  if (/^(feature|feat)\//i.test(branch)) return 'task';
  return 'diario';
}
import { loadIndex, tokenize, STOP } from '../maestro/maestro.js';

const MAX_ITEM = 260;
const MAX_POR_SECAO = { feito: 6, conversas: 4, duvidas: 3, pendencias: 5, licoes: 2, backend: 4, permissoes: 3, codigo: 3, commits: 4, resolucao: 3, validacao: 3, historico: 2, descricao: 2, review: 2, figma: 2 };

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* --------------------------- limpar e quebrar texto -------------------------- */

function semCodigo(texto) {
  return texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]{1,80}>/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l))       // linhas de tabela
    .filter((l) => !/📒 Maestro/.test(l))
    .join('\n');
}

function limparFrase(f) {
  return f
    .replace(/\*\*|__/g, '')
    .replace(/^\s*(?:[-*•>]|\d+[.)])\s+/, '')
    .replace(/^#+\s*/, '')
    .replace(/^[A-ZÀ-Ú][\wÀ-ú]+:\s+(?=\S)/, (m) => (/^(Causa|Correção|Correcao|Decisão|Decisao|Pendente|Pendência|Lição|Licao|Dúvida|Duvida|Resultado|Motivo|Solução|Solucao)/i.test(m) ? m : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function frases(texto) {
  const out = [];
  for (const linha of semCodigo(texto).split('\n')) {
    const l = linha.trim();
    if (!l) continue;
    // bullets e linhas curtas ficam inteiras; paragrafos longos viram frases
    const partes = l.length > 320 && !/^\s*[-*•]/.test(l) ? l.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])/) : [l];
    for (const p of partes) {
      const titulo = /^\s*#/.test(l) || /^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(l) || /\(s[oó] se houver\)/.test(l) || /:\s*$/.test(p.trim());
      let f = limparFrase(p).replace(/^(entendido|certo|sim|nao|não|ok|boa|otimo|ótimo|pronto|perfeito|exato|isso)[.,!:]\s+/i, '');
      f = f.charAt(0).toUpperCase() + f.slice(1);
      if (f.length >= 40 && !titulo) out.push({ texto: f, bullet: /^\s*(?:[-*•]|\d+[.)])\s+/.test(l) });
    }
  }
  return out;
}

function encurtar(t) {
  if (t.length <= MAX_ITEM) return t;
  const corte = t.slice(0, MAX_ITEM);
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('; '));
  return `${(fim > 120 ? corte.slice(0, fim + 1) : corte).trim()}…`;
}

/* --------------------------------- regras ---------------------------------- */

const R = {
  causa: /(?<!por )\bcausa\b|\bo problema (era|e|esta|estava)\b|(?<!o )\bmotivo:|\borigem do (bug|erro)\b/,
  correcao: /\b(correcao|corrigi|corrigido|a solucao|resolvi|resolvido|passou a|agora (o|a|ele|ela) )\b/,
  decisao: /\b(decisao:|decisao do|decidi|decidimos|ficou decidido|vamos (manter|usar|seguir)|fica assim|optei por)\b/,
  pendente: /\b((fica|ficam|ficou|esta|estao|ainda|item|itens) pendentes?|pendentes?:|pendencias?:|falta(m)? (testar|validar|fazer|confirmar|rodar)|ainda nao (foi |foram )?(testad|commitad|validad|feit|rodad|confirmad)|precisa (testar|validar|confirmar)|todo:)/,
  duvida: /\b(duvida em aberto|a confirmar|confirmar com|ainda em aberto|nao confirmad[oa]|nao esta claro)\b/,
  licao: /\b(licao|licoes|aprendizado|aprendi que)\b|^⚠️/,
  endpoint: /\b(GET|POST|PUT|PATCH|DELETE)\s+\/[\w/{}:.\-]+|\/api\/[\w/{}:.\-]+|\/v\d\/[\w/{}:.\-]+/i,
  permissao: /permiss/,
  camel: /\b[a-z]+[A-Z][A-Za-z]+\b/,
  validacao: /\b(testei|validei|reproduzi|simulado|validado|funcionou|nao funcionou|confirmei)\b/,
  review: /\bveredito\b|^⛔|\bachado \d/,
  figma: /\bfigma\b/,
  feitoVerbo: /\b(criei|criad[oa]s?|adicionei|adicionad[oa]s?|mudei|alterei|alterad[oa]s?|troquei|trocad[oa]s?|removi|removid[oa]s?|corrigi|implementei|ajustei|ajustad[oa]s?|movi|renomeei|substitui|extrai|apliquei|aplicad[oa]s?|virou|ficou)\b/,
  conversaVerbo: /\b(disse|falou|respondeu|pediu|confirmou|mandou|comentou|avisou|explicou|sugeriu)\b/,
  pedidoAoDev: /\b(quer que eu|posso (seguir|fazer|comecar)|prefere|me avise|confere|qual (voce|prefere))\b/,
};

function pessoasCitadas(msgsDev) {
  const nomes = new Map();
  const re = /\b(?:o|a|com o|com a|pro|pra|do|da|ao|à)\s+([A-ZÀ-Ú][a-zà-ú]{2,})(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?/g;
  const ignorar = new Set(['Claude', 'Figma', 'Slack', 'React', 'Node', 'Mac', 'Windows', 'Haiku', 'Opus', 'Maestro', 'Git', 'Github', 'ClickUp', 'Clickup', 'Sprint', 'Portaria', 'Boletos', 'Recursos', 'Autotriagem']);
  for (const m of msgsDev) {
    for (const x of m.texto.matchAll(re)) if (!ignorar.has(x[1])) nomes.set(x[1], (nomes.get(x[1]) ?? 0) + 1);
    for (const x of m.texto.matchAll(/^([A-ZÀ-Ú][a-zà-ú]{2,})(?:\s*\([^)]{1,20}\))?:\s/gm)) if (!ignorar.has(x[1])) nomes.set(x[1], (nomes.get(x[1]) ?? 0) + 1);
  }
  return [...nomes.keys()];
}

/* ------------------------------- extracao ---------------------------------- */

function adicionar(secoes, chave, texto, vistos) {
  const t = encurtar(texto);
  const k = norm(t).replace(/[^a-z0-9]/g, '').slice(0, 70);
  if (!k || vistos.has(k)) return;
  vistos.add(k);
  (secoes[chave] ??= []).push(t);
}

const TEMPORARIO = /\/(private\/)?tmp\/|\/\.claude\/|\/scratchpad\/|\\Temp\\/i;

/** Arquivos editados, com o caminho relativo ao projeto em que estao (raiz git ou cwd). */
function arquivosEditados(msgs, cwd) {
  const arquivos = new Map();
  const base = String(cwd ?? '').replace(/\\/g, '/').replace(/\/$/, '');
  for (const m of msgs) {
    if (m.quem !== 'ferramenta') continue;
    const caminho = String(m.entrada?.file_path ?? m.entrada?.notebook_path ?? '').replace(/\\/g, '/');
    if (!caminho || TEMPORARIO.test(caminho) || !['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(m.nome)) continue;
    const dentro = base && caminho.startsWith(`${base}/`);
    const casa = (process.env.HOME ?? process.env.USERPROFILE ?? '').replace(/\\/g, '/');
    const relativo = dentro
      ? caminho.slice(base.length + 1)
      : /\/(src|public|app|lib|scripts|maestro)\//.test(caminho)
        ? caminho.replace(/^.*?\/(src|public|app|lib|scripts|maestro)\//, '$1/')
        : casa && caminho.startsWith(casa) ? `~${caminho.slice(casa.length)}` : caminho;
    const projeto = dentro ? base.split('/').pop() : caminho.split('/').slice(0, -1).find((_, i, a) => a[i + 1] && /^(src|public|app|lib|scripts|maestro)$/.test(a[i + 1])) ?? caminho.split('/').at(-2);
    const anterior = arquivos.get(relativo);
    arquivos.set(relativo, { estado: anterior?.estado === 'criado' || m.nome === 'Write' ? 'criado' : 'alterado', dentro, projeto });
  }
  return arquivos;
}

function commits(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.quem !== 'ferramenta' || m.nome !== 'Bash') continue;
    const c = String(m.entrada?.command ?? '').match(/git commit[^\n]*?-m\s+(["'])([\s\S]*?)\1/);
    if (c) out.push(c[2].split('\n')[0].trim());
  }
  return out;
}

function palavrasChave(msgs) {
  let index;
  try { index = loadIndex(); } catch { index = null; }
  const N = Math.max(1, index?.live.length ?? 1);
  const contagem = new Map();
  for (const m of msgs) {
    if (m.quem === 'ferramenta') continue;
    for (const t of tokenize(semCodigo(m.texto).replace(/`[^`]*`/g, ' ').replace(/\S+\/\S+/g, ' '))) {
      if (t.length < 5 || STOP.has(t) || /^\d+$/.test(t)) continue;
      contagem.set(t, (contagem.get(t) ?? 0) + 1);
    }
  }
  return [...contagem.entries()]
    .filter(([, n]) => n >= 2)
    .map(([t, n]) => [t, n * Math.log(1 + N / ((index?.vocab.get(t) ?? 0) + 1))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);
}

function tituloDe(trecho, msgsDev) {
  const daBranch = (trecho.branch || '').replace(/^[\w-]+\//, '').replace(/^[a-z0-9]{6,12}-/i, '').replace(/-/g, ' ').trim();
  if (daBranch) return daBranch.charAt(0).toUpperCase() + daBranch.slice(1);
  const primeira = msgsDev[0]?.texto.split('\n')[0] ?? 'Conversa';
  return encurtar(primeira).slice(0, 80);
}

function resumoDe(msgsClaude) {
  for (let i = msgsClaude.length - 1; i >= 0; i--) {
    const fs = frases(msgsClaude[i].texto).filter((f) => !R.pedidoAoDev.test(norm(f.texto)));
    if (fs.length && msgsClaude[i].texto.length > 200) return encurtar(fs[0].texto);
  }
  return '';
}

export function resumirSemIA(trecho) {
  const msgs = trecho.msgs ?? [];
  const dev = msgs.filter((m) => m.quem === 'dev');
  const claude = msgs.filter((m) => m.quem === 'claude');
  const secoes = {};
  const vistos = new Set();

  // 1. fatos das ferramentas
  const arqs = arquivosEditados(msgs, trecho.cwd);
  // Conversa aberta num repositorio mas mexendo em outro projeto: a branch nao diz nada
  // sobre o assunto. Vai para o Diario, com o nome do projeto onde os arquivos estao.
  // So arquivos de codigo contam: anotacao em .md fora do repositorio (memorias, docs) e
  // documentacao da propria task, nao sinal de que o assunto e outro projeto.
  const deCodigo = [...arqs].filter(([k]) => !/\.(md|txt)$/i.test(k)).map(([, v]) => v);
  const fora = deCodigo.filter((v) => !v.dentro);
  if (deCodigo.length && fora.length / deCodigo.length > 0.5) {
    const conta = new Map();
    for (const v of fora) conta.set(v.projeto, (conta.get(v.projeto) ?? 0) + 1);
    trecho = { ...trecho, branch: '', projetoReal: [...conta].sort((a, b) => b[1] - a[1])[0][0] };
  }
  const tipo = tipoPelaBranch(trecho.branch);
  const criados = [...arqs].filter(([, v]) => v.estado === 'criado').map(([k]) => k);
  const alterados = [...arqs].filter(([, v]) => v.estado === 'alterado').map(([k]) => k);
  const feito = [];
  if (criados.length) feito.push(`Arquivos criados: ${criados.slice(0, 8).map((a) => `\`${a}\``).join(', ')}${criados.length > 8 ? ` (+${criados.length - 8})` : ''}`);
  if (alterados.length) feito.push(`Arquivos alterados: ${alterados.slice(0, 8).map((a) => `\`${a}\``).join(', ')}${alterados.length > 8 ? ` (+${alterados.length - 8})` : ''}`);
  const pastas = [...new Set([...arqs].filter(([, v]) => v.dentro).map(([a]) => a.split('/').slice(0, -1).slice(0, 3).join('/')).filter(Boolean))];
  if (pastas.length && tipo === 'task') adicionar(secoes, 'codigo', `Mexido em: ${pastas.slice(0, 5).map((p) => `\`${p}/\``).join(', ')}`, vistos);
  for (const c of commits(msgs)) adicionar(secoes, 'commits', c, vistos);

  // 2 e 3. frases do Claude, da mais recente para a mais antiga (a versao final ganha)
  const doClaude = [];
  for (let i = claude.length - 1; i >= 0; i--) {
    const ultimaGrande = i >= claude.length - 2;
    for (const f of frases(claude[i].texto)) doClaude.push({ ...f, ultimaGrande });
  }
  for (const f of doClaude) {
    const n = norm(f.texto);
    if (R.pedidoAoDev.test(n) || n.endsWith('?')) continue;
    if ((R.causa.test(n) && (tipo === 'chamado' || f.ultimaGrande)) || (tipo === 'chamado' && R.correcao.test(n))) adicionar(secoes, tipo === 'chamado' ? 'resolucao' : 'feito', f.texto, vistos);
    else if (R.decisao.test(n)) adicionar(secoes, tipo === 'chamado' ? 'resolucao' : 'feito', /^decis/.test(n) ? f.texto : `Decisão: ${f.texto}`, vistos);
    else if (R.endpoint.test(f.texto) && tipo === 'task') adicionar(secoes, 'backend', f.texto, vistos);
    else if (R.permissao.test(n) && R.camel.test(f.texto) && tipo === 'task') adicionar(secoes, 'permissoes', f.texto, vistos);
    else if (R.pendente.test(n)) adicionar(secoes, 'pendencias', f.texto, vistos);
    else if (R.duvida.test(n) && tipo === 'task') adicionar(secoes, 'duvidas', f.texto, vistos);
    else if (R.licao.test(n) && tipo === 'task') adicionar(secoes, 'licoes', f.texto, vistos);
    else if (R.review.test(n) && tipo === 'task') adicionar(secoes, 'review', f.texto, vistos);
    else if (f.ultimaGrande && f.bullet && R.feitoVerbo.test(n)) feito.push(encurtar(f.texto));
  }

  // 4. o que o dev trouxe: falas de colegas, validacoes, pendencias que ele pediu
  const pessoas = pessoasCitadas(dev);
  for (let i = dev.length - 1; i >= 0; i--) {
    for (const f of frases(dev[i].texto)) {
      const n = norm(f.texto);
      const cita = pessoas.some((p) => f.texto.includes(p)) && (R.conversaVerbo.test(n) || /^[A-ZÀ-Ú][a-zà-ú]+(\s*\([^)]{1,20}\))?:/.test(f.texto));
      if (cita) adicionar(secoes, tipo === 'chamado' ? 'historico' : 'conversas', f.texto, vistos);
      else if (tipo === 'chamado' && R.validacao.test(n)) adicionar(secoes, 'validacao', f.texto, vistos);
      else if (R.pendente.test(n) && /\b(depois|lembrar|nao esquecer)\b/.test(n)) adicionar(secoes, 'pendencias', f.texto, vistos);
    }
  }

  // limites por secao, ordem cronologica de novo (estavam do mais novo para o mais velho)
  for (const [k, v] of Object.entries(secoes)) secoes[k] = v.slice(0, MAX_POR_SECAO[k] ?? 3).reverse();
  const itensFeitos = [...new Set(feito)].slice(0, MAX_POR_SECAO.feito);
  if (tipo === 'chamado') {
    if (itensFeitos.length) secoes.resolucao = [...(secoes.resolucao ?? []), ...itensFeitos].slice(0, 5);
    delete secoes.feito;
  } else {
    const extras = secoes.feito ?? [];
    secoes.feito = { titulo: 'sessão com o Claude', itens: [...itensFeitos, ...extras].slice(0, 8) };
  }

  const total = Object.entries(secoes).reduce((s, [k, v]) => s + (k === 'feito' ? v.itens.length : v.length), 0);
  const relevante = total >= 2 || arqs.size > 0;
  return {
    relevante,
    titulo: tituloDe(trecho, dev),
    resumo: resumoDe(claude),
    secoes,
    palavras: palavrasChave(msgs),
    feitoPor: 'maestro-local',
    branchUsada: trecho.branch,
    projetoReal: trecho.projetoReal ?? null,
  };
}
