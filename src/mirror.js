// Espelho em Markdown do banco: o SQLite continua sendo a fonte da verdade e,
// depois de cada alteracao, notas-md/ e regenerada inteira a partir dele.

import { existsSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportAll } from './repo.js';
import { writeMarkdown } from './markdown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIRROR_DIR = process.env.MIRROR_DIR ?? join(ROOT, 'notas-md');
const UPLOADS_DIR = join(ROOT, 'data', 'uploads');
const DEBOUNCE_MS = 2000;

let timer = null;
let tentativas = 0;
const TRAVADA = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

/**
 * Gera numa pasta temporaria e so depois troca pela atual: quem estiver lendo
 * notas-md/ nunca ve a pasta pela metade, e se a geracao falhar a anterior fica.
 */
export function mirrorNow() {
  const stamp = Date.now();
  const tmp = `${MIRROR_DIR}.tmp-${stamp}`;
  const old = `${MIRROR_DIR}.old-${stamp}`;
  try {
    const data = exportAll({ includeTrash: true });
    const result = writeMarkdown(data, { outDir: tmp, uploadsDir: UPLOADS_DIR });
    if (existsSync(MIRROR_DIR)) renameSync(MIRROR_DIR, old);
    renameSync(tmp, MIRROR_DIR);
    rmSync(old, { recursive: true, force: true });
    tentativas = 0;
    return result;
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    if (!existsSync(MIRROR_DIR) && existsSync(old)) renameSync(old, MIRROR_DIR);
    // No Windows a pasta nao pode ser renomeada enquanto algum programa a tem aberta
    // (VS Code, Explorer). Tenta de novo alguns segundos depois em vez de desistir.
    if (TRAVADA.has(err.code) && tentativas < 5) {
      tentativas += 1;
      clearTimeout(timer);
      timer = setTimeout(mirrorNow, 10000 * tentativas);
      timer.unref?.();
      console.error(`  espelho md: pasta em uso (${err.code}), nova tentativa em ${10 * tentativas}s`);
      return null;
    }
    tentativas = 0;
    console.error(`  espelho md falhou: ${err.message}`);
    return null;
  }
}

export function scheduleMirror() {
  clearTimeout(timer);
  timer = setTimeout(mirrorNow, DEBOUNCE_MS);
  timer.unref?.();
}
