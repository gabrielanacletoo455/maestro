#!/usr/bin/env node
// Uso: node maestro/cli.js "sua pergunta"
import { ask } from './maestro.js';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Uso: node maestro/cli.js "sua pergunta"');
  process.exit(1);
}
console.log(ask(query));
