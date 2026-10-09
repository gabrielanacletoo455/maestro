#!/usr/bin/env node
// Roda as perguntas de testes.json e mostra quantas o Maestro acerta.
// Uso: node maestro/eval.js [-v]   (-v mostra a resposta de cada pergunta)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask } from './maestro.js';
import { lembretes, briefing } from './lembretes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const tests = JSON.parse(readFileSync(join(HERE, 'testes.json'), 'utf8'));
const verbose = process.argv.includes('-v');
const NOW = Date.parse('2026-10-09T21:00:00Z');

let ok = 0;
for (const t of tests) {
  const out = ask(t.q, { now: NOW });
  const ids = [...out.matchAll(/#(p_[a-z0-9]+)/g)].map((m) => m[1]);
  const fails = [];
  if (t.first && ids[0] !== t.first) fails.push(`1o resultado devia ser ${t.first}, veio ${ids[0] ?? 'nada'}`);
  for (const id of t.has ?? []) if (!ids.includes(id)) fails.push(`faltou ${id}`);
  for (const id of t.not ?? []) if (ids.includes(id)) fails.push(`nao devia aparecer ${id}`);
  for (const s of t.texts ?? []) if (!out.includes(s)) fails.push(`faltou o texto "${s}"`);
  if (!fails.length) ok += 1;
  console.log(`${fails.length ? '❌' : '✅'} ${t.n}. ${t.q.slice(0, 70)}${t.q.length > 70 ? '…' : ''} (${out.length} chars)`);
  for (const f of fails) console.log(`     - ${f}`);
  if (verbose) console.log(out.replace(/^/gm, '     | '));
}
console.log(`\n${ok}/${tests.length} acertos`);

// Lembretes automaticos: o que aparece sozinho a cada mensagem (e o que NAO deve aparecer).
const casos = JSON.parse(readFileSync(join(HERE, 'testes-lembretes.json'), 'utf8'));
let okL = 0;
console.log('\nLembretes:');
for (const c of casos) {
  const { texto } = lembretes(c.q);
  const fails = [];
  if (c.nada && texto) fails.push('devia ficar em silencio');
  for (const id of c.tem ?? []) if (!texto.includes(id)) fails.push(`faltou ${id}`);
  for (const t of c.textos ?? []) if (!texto.includes(t)) fails.push(`faltou o texto "${t}"`);
  if (!fails.length) okL += 1;
  console.log(`${fails.length ? '❌' : '✅'} ${c.q} (${texto.length} chars)`);
  for (const f of fails) console.log(`     - ${f}`);
  if (verbose && texto) console.log(texto.replace(/^/gm, '     | '));
}
console.log(`\n${okL}/${casos.length} lembretes certos`);

const b = briefing({ branch: 'feature/868zzzzzz-consulta-cpf-validar-cadastro-moradores' });
const okB = b.includes('p_muo0ypvp6znm4hw') && b.includes('p_mugzrlhtfxciosm');
console.log(`${okB ? '✅' : '❌'} briefing de task nova de CPF traz as tasks de Consulta Segura CPF (${b.length} chars)`);
