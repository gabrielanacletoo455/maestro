#!/usr/bin/env node
// Exporta o workspace para uma pasta de Markdown avulsa. So LE o banco (via GET
// /api/export) — nao altera nada em data/. O espelho automatico (notas-md/) e
// gerado pelo proprio servidor; este script e para tirar uma copia separada.
//
// Uso: node scripts/export-md.mjs <pasta-destino>

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMarkdown } from '../src/markdown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const API = `http://localhost:${process.env.PORT ?? 4321}`;

if (!target) {
  console.error('Uso: node scripts/export-md.mjs <pasta-destino>');
  process.exit(1);
}
const OUT = join(ROOT, target);
if (existsSync(OUT)) {
  console.error(`A pasta ${OUT} ja existe. Escolha outro destino ou renomeie a atual.`);
  process.exit(1);
}

const res = await fetch(`${API}/api/export?assets=0`);
if (!res.ok) throw new Error(`Falha ao ler ${API}/api/export: ${res.status}`);
const raw = await res.text();

const { pages } = writeMarkdown(JSON.parse(raw), {
  outDir: OUT,
  uploadsDir: join(ROOT, 'data', 'uploads'),
  raw,
});
console.log(`${pages} paginas exportadas para ${OUT}`);
