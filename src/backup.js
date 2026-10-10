import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BACKUP_DIR = process.env.BACKUP_DIR ?? join(ROOT, 'data', 'backups');

const RECENT_MS = 48 * 60 * 60 * 1000; // nas ultimas 48h guarda todos os snapshots
const INTERVAL_MS = 15 * 60 * 1000;    // de quanto em quanto tempo tirar um novo
const AUTO_NAME = /^anotacoes-(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}-\d{2}\.db$/;

let lastChanges = null;

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = () =>
  new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');

/**
 * Snapshot do banco inteiro. `VACUUM INTO` copia de forma consistente mesmo com
 * o WAL ativo e com o servidor escrevendo — nao da para fazer isso com um `cp`.
 */
export function backupNow(reason = 'manual') {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM pages').get();
  if (!count) return null; // nao faz backup de banco vazio, so gera lixo

  // Periodico sem nenhuma escrita desde o ultimo snapshot: seria uma copia identica.
  const { changes } = db.prepare('SELECT total_changes() AS changes').get();
  if (reason === 'periodico' && changes === lastChanges) return null;
  lastChanges = changes;

  const path = join(BACKUP_DIR, `anotacoes-${stamp()}.db`);
  db.prepare('VACUUM INTO ?').run(path);
  prune();
  console.log(`  backup (${reason}): ${path}`);
  return path;
}

/**
 * Nunca perde um dia: das ultimas 48h guarda tudo; antes disso, o ultimo snapshot
 * de cada dia fica para sempre. So mexe nos arquivos do backup automatico
 * (anotacoes-AAAA-MM-DD-hh-mm-ss.db) — copias manuais com outro nome nunca sao apagadas.
 */
function prune() {
  const now = Date.now();
  const files = readdirSync(BACKUP_DIR)
    .map((f) => ({ f, day: f.match(AUTO_NAME)?.[1], t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .filter((x) => x.day)
    .sort((a, b) => b.t - a.t);

  const keptDays = new Set();
  for (const { f, day, t } of files) {
    if (now - t < RECENT_MS) {
      keptDays.add(day);
      continue;
    }
    if (keptDays.has(day)) unlinkSync(join(BACKUP_DIR, f));
    else keptDays.add(day);
  }
}

export function listBackups() {
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const s = statSync(join(BACKUP_DIR, f));
      return { name: f, size: s.size, at: new Date(s.mtimeMs).toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Backup na subida e a cada 15 min enquanto o servidor estiver de pe. */
export function startAutoBackup() {
  backupNow('startup');
  const timer = setInterval(() => backupNow('periodico'), INTERVAL_MS);
  timer.unref?.();
  return timer;
}
