#!/usr/bin/env node
// Uso:
//   maestro "sua pergunta"            busca nas notas (sem IA)
//   maestro importar                  importa conversas antigas do Claude Code (pergunta antes)
//   maestro importar status           como esta a importacao
//   maestro importar rodar 3          processa 3 conversas da fila agora (para medir o custo)
//   maestro importar aprovar [1,3]    aprova a previa (todos, ou so os numeros)
//   maestro importar descartar 2,4    descarta itens da previa
//   maestro importar cancelar         esvazia a fila
//   maestro resumir                   resume agora as conversas novas (sem esperar 30 min)
//   maestro status                    estado da escrita automatica
import { createInterface } from 'node:readline/promises';
import { ask } from './maestro.js';

const API = `http://localhost:${process.env.PORT ?? 4321}/api/maestro`;
const args = process.argv.slice(2);

async function chamar(caminho, corpo) {
  let res;
  try {
    res = await fetch(`${API}${caminho}`, corpo === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  } catch {
    throw new Error('o app Maestro nao esta rodando (http://localhost:4321). Ligue o app e tente de novo.');
  }
  const dados = await res.json();
  if (!res.ok) throw new Error(dados.error ?? `erro ${res.status}`);
  return dados;
}

const indices = (txt) => (!txt || txt === 'todos' ? 'todos' : txt.split(',').map((n) => Number(n.trim())).filter(Boolean));
const mil = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} milhoes` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n));

async function importar() {
  const sub = args[1];
  if (sub === 'status') return mostrarStatus();
  if (sub === 'aprovar') {
    const r = await chamar('/importacao/aprovar', { indices: indices(args[2]) });
    if (!r.length) return console.log('Nada para aprovar.');
    for (const x of r) console.log(`✅ ${x.titulo ?? 'sem titulo'}${x.criada ? ' (pagina nova)' : ''}`);
    return console.log(`\n${r.length} item(ns) gravado(s) nas notas.`);
  }
  if (sub === 'descartar') {
    const r = await chamar('/importacao/descartar', { indices: indices(args[2]) });
    return console.log(`${r.descartados} item(ns) descartado(s).`);
  }
  if (sub === 'cancelar') {
    const r = await chamar('/importacao/cancelar', {});
    return console.log(`Fila esvaziada (${r.removidos} conversa(s) que faltavam).`);
  }
  if (sub === 'rodar') {
    const max = Number(args[2]) || 1;
    console.log(`Processando ${max} conversa(s) agora...`);
    const r = await chamar('/importacao/rodar', { max });
    if (!r.ok) throw new Error(r.motivo);
    return console.log(`Feitas: ${r.feitas} · faltam na fila: ${r.faltam} · na previa: ${r.pendentes}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n📥 Importar conversas antigas do Claude Code para o Maestro\n');
    console.log('  1) todas');
    console.log('  2) so dos ultimos 30 dias');
    console.log('  3) escolher projetos');
    console.log('  4) cancelar');
    const escolha = (await rl.question('\nEscolha (1-4): ')).trim();
    if (!['1', '2', '3'].includes(escolha)) return console.log('Nada foi feito.');

    let projetos = null;
    if (escolha === '3') {
      const todos = await chamar('/importacao/candidatos', {});
      const nomes = [...new Set(todos.map((c) => c.projeto))];
      nomes.forEach((p, i) => console.log(`  ${i + 1}) ${p.replace(/^-Users-[^-]+-/, '')} (${todos.filter((c) => c.projeto === p).length} conversas)`));
      const sel = indices((await rl.question('Numeros separados por virgula: ')).trim());
      projetos = (sel === 'todos' ? nomes : sel.map((n) => nomes[n - 1])).filter(Boolean);
    }

    console.log('\nAnalisando as conversas (sem IA, so contando)...');
    const cand = await chamar('/importacao/candidatos', { dias: escolha === '2' ? 30 : null, projetos });
    if (!cand.length) return console.log('Nenhuma conversa com conteudo para importar.');
    const tokens = cand.reduce((s, c) => s + c.tokens, 0);
    const horas = Math.ceil(cand.length / 5);
    console.log(`\n  ${cand.length} conversa(s) com conteudo · estimativa: ~${mil(tokens)} tokens do Haiku (do seu plano do Claude)`);
    console.log(`  Ritmo: 5 conversas por hora, em segundo plano (~${horas}h no total). Pausa sozinha se o limite do plano apertar.`);
    console.log('  Os resumos vao para a pagina "📥 Importacao (para revisar)". NADA entra nas suas paginas sem voce aprovar.\n');
    const ok = (await rl.question('Comecar? (s/n): ')).trim().toLowerCase();
    if (!ok.startsWith('s')) return console.log('Nada foi feito.');
    await chamar('/importacao', { arquivos: cand.map((c) => c.arquivo) });
    console.log('\n✅ Importacao na fila. Acompanhe com `maestro importar status`.');
    console.log('   Para medir o custo antes: `maestro importar rodar 3` processa 3 agora; compare o uso do plano antes e depois.');
  } finally {
    rl.close();
  }
}

async function mostrarStatus() {
  const s = await chamar('/status');
  console.log(`Fila de importacao: ${s.fila} conversa(s) · na previa esperando aprovacao: ${s.pendentes}`);
  if (s.pausaAte) console.log(`Pausado ate ${new Date(s.pausaAte).toLocaleString('pt-BR')}`);
  if (s.ultimoErro) console.log(`Ultimo erro: ${s.ultimoErro.mensagem}`);
}

try {
  if (args[0] === 'importar' && args.length <= 3) await importar();
  else if (args[0] === 'resumir' && args.length === 1) {
    const r = await chamar('/resumir', {});
    console.log(r.ok ? `Resumos gravados: ${r.feitos.filter((f) => f.gravado).length}` : `Nao resumiu: ${r.motivo}`);
  } else if (args[0] === 'status' && args.length === 1) await mostrarStatus();
  else {
    const query = args.join(' ').trim();
    if (!query) {
      console.error('Uso: maestro "sua pergunta"   (ou: maestro importar | maestro resumir | maestro status)');
      process.exit(1);
    }
    console.log(ask(query));
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
