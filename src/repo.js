import { db, uid, tx, reindexPage, touchPage, stripHtml } from './db.js';

const plain = (row) => (row ? { ...row } : null);
const plainAll = (rows) => rows.map((r) => ({ ...r }));

/* ---------------------------------- pages --------------------------------- */

export const pages = {
  tree() {
    const rows = plainAll(
      db
        .prepare(
          `SELECT id, parent_id, title, icon, favorite, position, updated_at
           FROM pages WHERE deleted_at IS NULL ORDER BY position, created_at`
        )
        .all()
    );

    const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      const parent = node.parent_id ? byId.get(node.parent_id) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  },

  favorites() {
    return plainAll(
      db
        .prepare(
          `SELECT id, title, icon FROM pages
           WHERE favorite = 1 AND deleted_at IS NULL ORDER BY updated_at DESC`
        )
        .all()
    );
  },

  trash() {
    return plainAll(
      db
        .prepare(
          `SELECT id, title, icon, deleted_at FROM pages
           WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
        )
        .all()
    );
  },

  get(id) {
    const page = plain(db.prepare('SELECT * FROM pages WHERE id = ?').get(id));
    if (!page) return null;
    page.blocks = plainAll(
      db
        .prepare(
          `SELECT id, parent_id, type, content, props, position
           FROM blocks WHERE page_id = ? ORDER BY position, created_at`
        )
        .all(id)
    ).map((b) => ({ ...b, props: JSON.parse(b.props || '{}') }));
    page.breadcrumb = pages.breadcrumb(id);
    return page;
  },

  breadcrumb(id) {
    const trail = [];
    let current = id;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const row = db.prepare('SELECT id, parent_id, title, icon FROM pages WHERE id = ?').get(current);
      if (!row) break;
      trail.unshift({ id: row.id, title: row.title, icon: row.icon });
      current = row.parent_id;
    }
    return trail;
  },

  create({ parentId = null, title = '', icon = '' } = {}) {
    return tx(() => {
      const id = uid('p');
      const { next } = db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pages
           WHERE parent_id IS ? AND deleted_at IS NULL`
        )
        .get(parentId);

      db.prepare(
        'INSERT INTO pages (id, parent_id, title, icon, position) VALUES (?, ?, ?, ?, ?)'
      ).run(id, parentId, title, icon, next);

      db.prepare(
        'INSERT INTO blocks (id, page_id, type, content, position) VALUES (?, ?, ?, ?, 0)'
      ).run(uid(), id, 'paragraph', '');

      reindexPage(id);
      return pages.get(id);
    });
  },

  update(id, patch) {
    const allowed = ['title', 'icon', 'cover', 'favorite', 'parent_id', 'position'];
    const fields = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!fields.length) return pages.get(id);

    if (fields.includes('parent_id') && wouldCycle(id, patch.parent_id)) {
      throw Object.assign(new Error('Nao da para mover uma pagina para dentro dela mesma'), {
        status: 400,
      });
    }

    const sql = `UPDATE pages SET ${fields.map((f) => `${f} = ?`).join(', ')},
                 updated_at = datetime('now') WHERE id = ?`;
    db.prepare(sql).run(...fields.map((f) => patch[f]), id);
    if (fields.includes('title')) reindexPage(id);
    return pages.get(id);
  },

  remove(id) {
    // Soft delete recursivo: a pagina e toda a subarvore vao para a lixeira.
    return tx(() => {
      for (const pid of descendants(id)) {
        db.prepare("UPDATE pages SET deleted_at = datetime('now') WHERE id = ?").run(pid);
        db.prepare('DELETE FROM search_fts WHERE page_id = ?').run(pid);
      }
      return { ok: true };
    });
  },

  restore(id) {
    return tx(() => {
      for (const pid of descendants(id, { includeDeleted: true })) {
        db.prepare('UPDATE pages SET deleted_at = NULL WHERE id = ?').run(pid);
        reindexPage(pid);
      }
      return pages.get(id);
    });
  },

  purge(id) {
    return tx(() => {
      db.prepare('DELETE FROM search_fts WHERE page_id = ?').run(id);
      db.prepare('DELETE FROM pages WHERE id = ?').run(id); // CASCADE limpa blocos e filhos
      return { ok: true };
    });
  },
};

function descendants(id, { includeDeleted = false } = {}) {
  const filter = includeDeleted ? '' : 'AND deleted_at IS NULL';
  const out = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    out.push(current);
    const kids = db
      .prepare(`SELECT id FROM pages WHERE parent_id = ? ${filter}`)
      .all(current);
    stack.push(...kids.map((k) => k.id));
  }
  return out;
}

function wouldCycle(id, newParentId) {
  let cursor = newParentId;
  const seen = new Set();
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = db.prepare('SELECT parent_id FROM pages WHERE id = ?').get(cursor)?.parent_id ?? null;
  }
  return false;
}

/* --------------------------------- blocks --------------------------------- */

export const blocks = {
  create(pageId, { afterId = null, type = 'paragraph', content = '', props = {} } = {}) {
    return tx(() => {
      const id = uid();
      const position = positionAfter(pageId, afterId);
      db.prepare(
        `INSERT INTO blocks (id, page_id, type, content, props, position)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, pageId, type, content, JSON.stringify(props), position);
      touchPage(pageId);
      reindexPage(pageId);
      return blockById(id);
    });
  },

  update(id, patch) {
    const row = db.prepare('SELECT page_id FROM blocks WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('Bloco nao encontrado'), { status: 404 });

    const sets = [];
    const args = [];
    if (patch.type !== undefined) (sets.push('type = ?'), args.push(patch.type));
    if (patch.content !== undefined) (sets.push('content = ?'), args.push(patch.content));
    if (patch.props !== undefined) (sets.push('props = ?'), args.push(JSON.stringify(patch.props)));
    if (!sets.length) return blockById(id);

    db.prepare(
      `UPDATE blocks SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).run(...args, id);
    touchPage(row.page_id);
    if (patch.content !== undefined) reindexPage(row.page_id);
    return blockById(id);
  },

  remove(id) {
    const row = db.prepare('SELECT page_id FROM blocks WHERE id = ?').get(id);
    if (!row) return { ok: true };
    db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
    touchPage(row.page_id);
    reindexPage(row.page_id);
    return { ok: true };
  },

  /**
   * Substitui TODOS os blocos da pagina de uma vez, numa transacao unica.
   * E o que faz o undo/redo funcionar: em vez de replicar a operacao inversa de
   * cada acao, a gente so reescreve o estado inteiro do snapshot anterior.
   */
  replaceAll(pageId, list) {
    return tx(() => {
      const page = db.prepare('SELECT id FROM pages WHERE id = ?').get(pageId);
      if (!page) throw Object.assign(new Error('Pagina nao encontrada'), { status: 404 });

      db.prepare('DELETE FROM blocks WHERE page_id = ?').run(pageId);

      const insert = db.prepare(
        `INSERT INTO blocks (id, page_id, parent_id, type, content, props, position)
         VALUES (?, ?, NULL, ?, ?, ?, ?)`
      );
      list.forEach((block, i) =>
        insert.run(
          block.id ?? uid(),
          pageId,
          block.type ?? 'paragraph',
          block.content ?? '',
          JSON.stringify(block.props ?? {}),
          i
        )
      );

      touchPage(pageId);
      reindexPage(pageId);
      return pages.get(pageId);
    });
  },

  /** Reordena a pagina inteira a partir de uma lista de ids. Um round-trip so. */
  reorder(pageId, orderedIds) {
    return tx(() => {
      const stmt = db.prepare('UPDATE blocks SET position = ? WHERE id = ? AND page_id = ?');
      orderedIds.forEach((id, i) => stmt.run(i, id, pageId));
      touchPage(pageId);
      return { ok: true };
    });
  },
};

function blockById(id) {
  const row = plain(db.prepare('SELECT * FROM blocks WHERE id = ?').get(id));
  return row ? { ...row, props: JSON.parse(row.props || '{}') } : null;
}

function positionAfter(pageId, afterId) {
  if (!afterId) {
    const { min } = db
      .prepare('SELECT COALESCE(MIN(position), 1) AS min FROM blocks WHERE page_id = ?')
      .get(pageId);
    return min - 1;
  }
  const anchor = db.prepare('SELECT position FROM blocks WHERE id = ?').get(afterId);
  if (!anchor) return 0;
  const next = db
    .prepare(
      'SELECT MIN(position) AS pos FROM blocks WHERE page_id = ? AND position > ?'
    )
    .get(pageId, anchor.position);
  return next?.pos == null ? anchor.position + 1 : (anchor.position + next.pos) / 2;
}

/* --------------------------------- search --------------------------------- */

export function search(query) {
  const term = String(query || '').trim();
  if (term.length < 1) return [];

  // FTS5 exige sintaxe valida; prefixamos com * para busca incremental.
  const safe = term.replace(/["*]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!safe.length) return [];
  const expr = safe.map((t) => `"${t}"*`).join(' AND ');

  try {
    const rows = db
      .prepare(
        `SELECT s.page_id, s.block_id, p.title, p.icon, s.body
         FROM search_fts s JOIN pages p ON p.id = s.page_id
         WHERE search_fts MATCH ? AND p.deleted_at IS NULL
         ORDER BY rank LIMIT 30`
      )
      .all(expr);

    const seen = new Set();
    return plainAll(rows)
      .filter((r) => (seen.has(r.page_id) ? false : seen.add(r.page_id)))
      .map((r) => ({
        pageId: r.page_id,
        blockId: r.block_id,
        title: r.title || 'Sem titulo',
        icon: r.icon,
        excerpt: stripHtml(r.body).slice(0, 120),
      }));
  } catch {
    return [];
  }
}

/* --------------------------------- export --------------------------------- */

/**
 * Dump completo do workspace. As paginas saem em arvore (com os blocos dentro
 * de cada uma), do jeito que um humano leria — nao como as tabelas cruas.
 */
export function exportAll({ includeTrash = true } = {}) {
  const allPages = plainAll(
    db.prepare('SELECT * FROM pages ORDER BY position, created_at').all()
  ).filter((p) => includeTrash || !p.deleted_at);

  const blockRows = plainAll(
    db.prepare('SELECT * FROM blocks ORDER BY page_id, position, created_at').all()
  );

  const blocksByPage = new Map();
  for (const row of blockRows) {
    const list = blocksByPage.get(row.page_id) ?? [];
    list.push({
      id: row.id,
      type: row.type,
      content: row.content,
      props: JSON.parse(row.props || '{}'),
      position: row.position,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    blocksByPage.set(row.page_id, list);
  }

  const byId = new Map(
    allPages.map((p) => [
      p.id,
      {
        id: p.id,
        title: p.title,
        icon: p.icon,
        cover: p.cover,
        favorite: Boolean(p.favorite),
        in_trash: Boolean(p.deleted_at),
        created_at: p.created_at,
        updated_at: p.updated_at,
        blocks: blocksByPage.get(p.id) ?? [],
        children: [],
      },
    ])
  );

  const roots = [];
  for (const page of allPages) {
    const node = byId.get(page.id);
    const parent = page.parent_id ? byId.get(page.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return {
    format: 'anotacoes-gab-export',
    version: 1,
    exported_at: new Date().toISOString(),
    counts: { pages: allPages.length, blocks: blockRows.length },
    pages: roots,
  };
}
