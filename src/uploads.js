import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(ROOT, 'data', 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

const EXT_BY_MIME = Object.fromEntries(
  Object.entries(IMAGE_MIME).map(([ext, mime]) => [mime, ext])
);

export const mimeFor = (name) => IMAGE_MIME[extname(name).toLowerCase()] ?? null;

/** Nome unico e seguro: nunca confia no nome que veio do cliente. */
export function saveUpload(buffer, { filename = '', contentType = '' } = {}) {
  if (!buffer?.length) throw Object.assign(new Error('Arquivo vazio'), { status: 400 });
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('Imagem maior que 15MB'), { status: 413 });
  }

  const ext =
    EXT_BY_MIME[contentType] ??
    (IMAGE_MIME[extname(filename).toLowerCase()] ? extname(filename).toLowerCase() : null);

  if (!ext) throw Object.assign(new Error('Formato de imagem nao suportado'), { status: 415 });

  const label = basename(filename, extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  const stored = `${label || 'imagem'}-${randomUUID().slice(0, 8)}${ext}`;
  writeFileSync(join(UPLOAD_DIR, stored), buffer);

  return { name: stored, url: `/uploads/${stored}`, size: buffer.length, type: IMAGE_MIME[ext] };
}

export function readUpload(name) {
  const safe = basename(name);
  const path = join(UPLOAD_DIR, safe);
  if (!path.startsWith(UPLOAD_DIR)) return null;
  try {
    return { buffer: readFileSync(path), mime: mimeFor(safe) ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

/** Usado pelo export: devolve cada imagem como data URL, para o JSON ser autocontido. */
export function listUploads({ withData = false } = {}) {
  return readdirSync(UPLOAD_DIR)
    .filter((name) => mimeFor(name))
    .map((name) => {
      const path = join(UPLOAD_DIR, name);
      const entry = { name, url: `/uploads/${name}`, size: statSync(path).size, type: mimeFor(name) };
      if (withData) entry.dataUrl = `data:${entry.type};base64,${readFileSync(path).toString('base64')}`;
      return entry;
    });
}
