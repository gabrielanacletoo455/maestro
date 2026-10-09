import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH ?? join(ROOT, 'data', 'anotacoes.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL deixa leitura e escrita concorrentes; foreign_keys nao vem ligado por padrao no SQLite.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT REFERENCES pages(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    icon        TEXT NOT NULL DEFAULT '',
    cover       TEXT,
    position    REAL NOT NULL DEFAULT 0,
    favorite    INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    parent_id   TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'paragraph',
    content     TEXT NOT NULL DEFAULT '',
    props       TEXT NOT NULL DEFAULT '{}',
    position    REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_pages_parent   ON pages(parent_id, position);
  CREATE INDEX IF NOT EXISTS idx_pages_deleted  ON pages(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_blocks_page    ON blocks(page_id, parent_id, position);
`);

// Busca full-text sobre titulo de pagina + conteudo de bloco.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    page_id UNINDEXED,
    block_id UNINDEXED,
    title,
    body
  );
`);

export function uid(prefix = 'b') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Reconstroi o indice FTS da pagina inteira. Barato porque SQLite e local. */
export function reindexPage(pageId) {
  const page = db.prepare('SELECT id, title FROM pages WHERE id = ?').get(pageId);
  db.prepare('DELETE FROM search_fts WHERE page_id = ?').run(pageId);
  if (!page) return;

  const insert = db.prepare(
    'INSERT INTO search_fts (page_id, block_id, title, body) VALUES (?, ?, ?, ?)'
  );
  insert.run(pageId, null, page.title || 'Sem titulo', '');

  const blocks = db
    .prepare("SELECT id, content FROM blocks WHERE page_id = ? AND content <> ''")
    .all(pageId);
  for (const block of blocks) {
    insert.run(pageId, block.id, page.title || '', stripHtml(block.content));
  }
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function touchPage(pageId) {
  db.prepare("UPDATE pages SET updated_at = datetime('now') WHERE id = ?").run(pageId);
}

function seed() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM pages').get();
  if (count > 0) return;

  const pageId = uid('p');
  db.prepare(
    'INSERT INTO pages (id, parent_id, title, icon, position) VALUES (?, NULL, ?, ?, 0)'
  ).run(pageId, 'Comece por aqui', '👋');

  const blocks = [
    ['heading1', 'Bem-vindo as suas anotacoes'],
    ['paragraph', 'Tudo aqui roda local. O banco e um arquivo SQLite em <code>data/anotacoes.db</code>.'],
    ['heading2', 'Atalhos que valem a pena'],
    ['bulleted', 'Digite <code>/</code> em uma linha vazia para abrir o menu de blocos'],
    ['bulleted', 'Markdown funciona: <code># </code>, <code>- </code>, <code>1. </code>, <code>[] </code>, <code>&gt; </code>, <code>```</code>'],
    ['bulleted', 'Selecione texto para formatar, ou use Cmd+B / Cmd+I / Cmd+E'],
    ['bulleted', 'Arraste uma imagem para dentro da pagina, ou cole com Cmd+V'],
    ['bulleted', 'Cmd+, abre as configuracoes: tema e export do workspace'],
    ['todo', 'Criar minha primeira pagina'],
    ['todo', 'Arrastar um bloco pela alca da esquerda'],
    ['quote', 'Um bloco de cada vez.'],
    ['divider', ''],
    ['callout', 'Dica: Cmd+K abre a busca global.'],
  ];

  const insert = db.prepare(
    'INSERT INTO blocks (id, page_id, parent_id, type, content, position) VALUES (?, ?, NULL, ?, ?, ?)'
  );
  blocks.forEach(([type, content], i) => insert.run(uid(), pageId, type, content, i));
  reindexPage(pageId);
}

seed();
