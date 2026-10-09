// Utilitarios dos hooks do Claude Code. Um hook nunca pode quebrar a conversa:
// qualquer erro termina em silencio, sem saida.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function lerEntrada() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

export function responder(evento, contexto) {
  if (!contexto) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: evento, additionalContext: contexto } })
  );
}

export function branchAtual(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    return '';
  }
}

const arquivoVistos = (sessao) => join(tmpdir(), `maestro-vistos-${String(sessao).replace(/[^\w-]/g, '')}.json`);

export function lerVistos(sessao) {
  try {
    return new Set(JSON.parse(readFileSync(arquivoVistos(sessao), 'utf8')));
  } catch {
    return new Set();
  }
}

export function salvarVistos(sessao, vistos) {
  try {
    writeFileSync(arquivoVistos(sessao), JSON.stringify([...vistos].slice(-300)));
  } catch {}
}

export const desligado = () => process.env.MAESTRO_RESUMO === '1' || process.env.MAESTRO_LEMBRETES === '0';
