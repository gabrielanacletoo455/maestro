// Converte o export do banco (exportAll) numa pasta de Markdown: uma pagina por
// arquivo, subpaginas na pasta de mesmo nome, imagens em assets/. Nao toca no banco.

import { mkdirSync, writeFileSync, copyFileSync, linkSync, existsSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';

/* ------------------------------ HTML -> Markdown ---------------------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function lines(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '');
}

function wrap(mark, inner) {
  const lead = inner.match(/^\s*/)[0];
  const trail = inner.match(/\s*$/)[0];
  const core = inner.trim();
  return core ? `${lead}${mark}${core}${mark}${trail}` : inner;
}

function inline(html) {
  let s = lines(html);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => {
    const text = decode(c.replace(/<[^>]+>/g, ''));
    if (!text.trim()) return text;
    const ticks = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((t) => t.length)) + 1);
    return ticks.length > 1 ? `${ticks} ${text} ${ticks}` : ticks + text + ticks;
  });
  s = s.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const label = text.replace(/<[^>]+>/g, '').trim() || href;
    return `[${label}](${decode(href)})`;
  });
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => wrap('**', c));
  s = s.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => wrap('*', c));
  s = s.replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => wrap('~~', c));
  s = s.replace(/<[^>]+>/g, '');
  return decode(s).replace(/^\n+/, '').replace(/[ \t]+$/gm, '');
}

function codeText(html) {
  return decode(lines(html).replace(/<[^>]+>/g, '')).replace(/^\n+/, '');
}

const indent = (text, pad) => text.split('\n').join(`  \n${pad}`);

/* --------------------------------- blocos ---------------------------------- */

const LIST = new Set(['bulleted', 'numbered', 'todo']);

function blockToMd(block, n, file, asset) {
  const text = inline(block.content ?? '');
  switch (block.type) {
    case 'heading1': return `## ${text}`;
    case 'heading2': return `### ${text}`;
    case 'heading3': return `#### ${text}`;
    case 'bulleted': return `- ${indent(text, '  ')}`;
    case 'numbered': return `${n}. ${indent(text, '   ')}`;
    case 'todo': return `- [${block.props?.checked ? 'x' : ' '}] ${indent(text, '      ')}`;
    case 'quote': return `> ${text.split('\n').join('  \n> ')}`;
    case 'callout':
      return `> ${block.props?.emoji || '💡'} ${text.split('\n').join('  \n> ')}`;
    case 'divider': return '---';
    case 'code': return '```\n' + codeText(block.content ?? '') + '\n```';
    case 'image': {
      const url = asset(block.props?.url, file);
      return url ? `![${text || block.props?.name || 'imagem'}](${url})` : '';
    }
    case 'subpage': return `📄 ${text}`;
    default: return text.split('\n').join('  \n');
  }
}

function pageToMd(page, file, childLinks, asset) {
  const front = [
    '---',
    `id: ${page.id}`,
    `title: ${JSON.stringify(page.title || 'Sem titulo')}`,
    page.icon ? `icon: ${page.icon}` : null,
    page.favorite ? 'favorite: true' : null,
    page.in_trash ? 'in_trash: true' : null,
    page.cover ? `cover: ${asset(page.cover, file)}` : null,
    `created_at: ${toIso(page.created_at)}`,
    `updated_at: ${toIso(page.updated_at)}`,
    '---',
  ].filter(Boolean);

  const body = [];
  let n = 0;
  let prev = null;
  for (const block of page.blocks) {
    n = block.type === 'numbered' ? n + 1 : 0;
    const md = blockToMd(block, n, file, asset);
    if (!md.trim() && block.type === 'paragraph') {
      prev = null;
      continue;
    }
    const tight = prev && LIST.has(prev) && LIST.has(block.type);
    body.push(tight ? '\n' : '\n\n', md);
    prev = block.type;
  }

  const title = `# ${page.icon ? page.icon + ' ' : ''}${page.title || 'Sem titulo'}`;
  const children = childLinks.length
    ? '\n\n## Subpaginas\n\n' + childLinks.map((c) => `- [${c.title}](${c.href})`).join('\n')
    : '';
  return `${front.join('\n')}\n\n${title}${body.join('')}${children}\n`;
}

const toIso = (sqlite) => (sqlite ? sqlite.replace(' ', 'T') + 'Z' : '');

function safeName(title) {
  const name = (title || 'Sem titulo')
    .replace(/[\\/:*?"<>|#\n\r\t]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  // Nomes que o Windows reserva para dispositivos nao podem virar arquivo.
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) return `${name}_`;
  return name || 'Sem titulo';
}

function uniqueIn(dir, name, taken) {
  const used = taken.get(dir) ?? new Set();
  taken.set(dir, used);
  let candidate = name;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${name} (${i})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function writeMarkdown(data, { outDir, uploadsDir, raw }) {
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  writeFileSync(join(outDir, '_original.json'), raw ?? JSON.stringify(data, null, 2));

  const copied = new Set();
  const asset = (url, fromFile) => {
    if (!url?.startsWith('/uploads/')) return url;
    const name = basename(url);
    if (!copied.has(name)) {
      const src = join(uploadsDir, name);
      const dest = join(outDir, 'assets', name);
      if (existsSync(src)) {
        try {
          linkSync(src, dest);
        } catch {
          copyFileSync(src, dest);
        }
      }
      copied.add(name);
    }
    return relative(dirname(fromFile), join(outDir, 'assets', name)).split('\\').join('/');
  };

  const taken = new Map([[outDir, new Set(['readme', 'assets', '_lixeira', '_original'])]]);
  const index = [];

  const writePage = (page, dir, depth) => {
    mkdirSync(dir, { recursive: true });
    const name = uniqueIn(dir, safeName(page.title), taken);
    const file = join(dir, `${name}.md`);
    const childDir = join(dir, name);

    const childLinks = page.children.map((child) => {
      const childFile = writePage(child, childDir, depth + 1);
      return { title: child.title || 'Sem titulo', href: encodeURI(relative(dir, childFile).split('\\').join('/')) };
    });

    index.push({ depth, title: page.title || 'Sem titulo', file });
    writeFileSync(file, pageToMd(page, file, childLinks, asset));
    return file;
  };

  for (const page of data.pages.filter((p) => !p.in_trash)) writePage(page, outDir, 0);
  for (const page of data.pages.filter((p) => p.in_trash)) writePage(page, join(outDir, '_lixeira'), 0);

  const readme = [
    '# Maestro — notas em Markdown',
    '',
    `Gerado em ${data.exported_at} a partir do banco (\`data/anotacoes.db\`), que continua sendo a fonte da verdade.`,
    '**Nao edite estes arquivos**: a pasta e regenerada a cada alteracao no app.',
    `${data.counts.pages} paginas, ${data.counts.blocks} blocos, ${copied.size} imagens.`,
    '',
    '- Cada pagina e um `.md`; subpaginas ficam na pasta de mesmo nome ao lado.',
    '- Paginas da lixeira ficam em `_lixeira/`. Imagens em `assets/`.',
    '- `_original.json` e o export completo do banco (ids, posicoes e horario de cada bloco).',
    '- Horarios em UTC.',
    '',
    '## Paginas',
    '',
    ...index
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((p) => `${'  '.repeat(p.depth)}- [${p.title}](${encodeURI(relative(outDir, p.file).split('\\').join('/'))})`),
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'README.md'), readme);

  return { pages: index.length, images: copied.size };
}
