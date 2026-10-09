import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages, blocks, search, exportAll } from './repo.js';
import { saveUpload, readUpload, listUploads, MAX_UPLOAD_BYTES } from './uploads.js';
import { startAutoBackup, backupNow, listBackups, BACKUP_DIR } from './backup.js';
import { mirrorNow, scheduleMirror, MIRROR_DIR } from './mirror.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

async function readRaw(req, limit = MAX_UPLOAD_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error('Arquivo muito grande'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON invalido'), { status: 400 });
  }
}

/* Rotas declaradas como [metodo, regex, handler]. O regex captura os ids. */
const routes = [
  ['GET', /^\/api\/pages$/, () => ({ tree: pages.tree(), favorites: pages.favorites() })],
  ['GET', /^\/api\/trash$/, () => pages.trash()],
  ['POST', /^\/api\/pages$/, (_m, body) => pages.create(body)],
  ['GET', /^\/api\/pages\/([\w-]+)$/, (m) => pages.get(m[1]) ?? notFound()],
  ['PATCH', /^\/api\/pages\/([\w-]+)$/, (m, body) => pages.update(m[1], body)],
  ['DELETE', /^\/api\/pages\/([\w-]+)$/, (m) => pages.remove(m[1])],
  ['POST', /^\/api\/pages\/([\w-]+)\/restore$/, (m) => pages.restore(m[1])],
  ['DELETE', /^\/api\/pages\/([\w-]+)\/purge$/, (m) => pages.purge(m[1])],

  ['POST', /^\/api\/pages\/([\w-]+)\/blocks$/, (m, body) => blocks.create(m[1], body)],
  ['PUT', /^\/api\/pages\/([\w-]+)\/blocks\/order$/, (m, body) =>
    blocks.reorder(m[1], body.ids ?? []),
  ],
  ['PUT', /^\/api\/pages\/([\w-]+)\/blocks$/, (m, body) =>
    blocks.replaceAll(m[1], body.blocks ?? []),
  ],
  ['PATCH', /^\/api\/blocks\/([\w-]+)$/, (m, body) => blocks.update(m[1], body)],
  ['DELETE', /^\/api\/blocks\/([\w-]+)$/, (m) => blocks.remove(m[1])],
];

function notFound() {
  throw Object.assign(new Error('Nao encontrado'), { status: 404 });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(PUBLIC, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(file);
  } catch {
    // SPA fallback: qualquer rota desconhecida entrega o index.
    const file = await readFile(join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(file);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/uploads/')) {
    const file = readUpload(decodeURIComponent(url.pathname.slice('/uploads/'.length)));
    if (!file) return json(res, 404, { error: 'Imagem nao encontrada' });
    res.writeHead(200, {
      'Content-Type': file.mime,
      'Content-Length': file.buffer.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return res.end(file.buffer);
  }

  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

  if (req.method !== 'GET') {
    res.on('finish', () => res.statusCode < 400 && scheduleMirror());
  }

  if (url.pathname === '/api/search' && req.method === 'GET') {
    return json(res, 200, search(url.searchParams.get('q')));
  }

  // Export: baixa o workspace inteiro como um unico JSON autocontido.
  if (url.pathname === '/api/export' && req.method === 'GET') {
    const withAssets = url.searchParams.get('assets') !== '0';
    const payload = {
      ...exportAll({ includeTrash: url.searchParams.get('trash') !== '0' }),
      assets: listUploads({ withData: withAssets }),
    };
    const body = JSON.stringify(payload, null, 2);
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="maestro-${stamp}.json"`,
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(body);
  }

  // Upload de imagem: corpo binario cru + nome no header (sem multipart, sem lib).
  if (url.pathname === '/api/uploads' && req.method === 'POST') {
    try {
      const buffer = await readRaw(req);
      const filename = decodeURIComponent(req.headers['x-filename'] ?? '');
      return json(res, 200, saveUpload(buffer, { filename, contentType: req.headers['content-type'] }));
    } catch (err) {
      return json(res, err.status ?? 500, { error: err.message });
    }
  }

  if (url.pathname === '/api/uploads' && req.method === 'GET') {
    return json(res, 200, listUploads());
  }

  if (url.pathname === '/api/backups' && req.method === 'GET') {
    return json(res, 200, { dir: BACKUP_DIR, backups: listBackups() });
  }

  if (url.pathname === '/api/backups' && req.method === 'POST') {
    const path = backupNow('manual');
    return json(res, 200, { ok: Boolean(path), path, backups: listBackups() });
  }

  for (const [method, pattern, handler] of routes) {
    const match = url.pathname.match(pattern);
    if (!match || req.method !== method) continue;
    try {
      const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(req) : null;
      return json(res, 200, handler(match, body) ?? { ok: true });
    } catch (err) {
      return json(res, err.status ?? 500, { error: err.message });
    }
  }

  json(res, 404, { error: `Rota ${req.method} ${url.pathname} nao existe` });
});

server.listen(PORT, () => {
  console.log(`\n  Maestro rodando em http://localhost:${PORT}`);
  startAutoBackup();
  const mirrored = mirrorNow();
  if (mirrored) console.log(`  Espelho md: ${MIRROR_DIR} (${mirrored.pages} paginas)`);
  console.log(`  Banco: ${process.env.DB_PATH ?? join(ROOT, 'data', 'anotacoes.db')}\n`);
});
