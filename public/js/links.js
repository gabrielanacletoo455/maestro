/**
 * Reconhecimento e edicao de links dentro dos blocos.
 * Tudo opera sobre o caret/selecao do contenteditable, entao mexe com Range.
 */

const TRAILING_URL = /(^|\s)((?:https?:\/\/|www\.)[^\s<]+?)([.,;:!?)]*)(\s)$/;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)$/;

/**
 * Normaliza o que o usuario digitou para um href seguro.
 * Retorna null para qualquer esquema que nao seja http(s)/mailto — isso e o que
 * barra `javascript:` e `data:` virarem link clicavel.
 */
export function safeHref(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^(https?:)\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value)) return value;
  if (/^www\./i.test(value)) return `https://${value}`;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(value)) return `mailto:${value}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // qualquer outro esquema
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(value)) return `https://${value}`;
  return null;
}

export function makeAnchor(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

function caretTextNode() {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  if (node.parentElement?.closest('a')) return null;
  return { sel, node, offset: sel.anchorOffset };
}

function replaceRange(node, start, end, anchor, caretAfter) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  range.deleteContents();
  range.insertNode(anchor);

  const sel = window.getSelection();
  const after = document.createRange();
  const rest = anchor.nextSibling;
  if (caretAfter && rest?.nodeType === Node.TEXT_NODE) {
    after.setStart(rest, Math.min(caretAfter, rest.textContent.length));
  } else {
    after.setStartAfter(anchor);
  }
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
}

/** Ao digitar espaco depois de uma URL, transforma em link. */
export function autolinkAtCaret() {
  const ctx = caretTextNode();
  if (!ctx) return false;

  const before = ctx.node.textContent.slice(0, ctx.offset);
  const match = before.match(TRAILING_URL);
  if (!match) return false;

  const [, , url, trailing, space] = match;
  const href = safeHref(url);
  if (!href) return false;

  const end = ctx.offset - space.length - trailing.length;
  replaceRange(ctx.node, end - url.length, end, makeAnchor(href, url), 1 + trailing.length);
  return true;
}

/** Converte `[texto](url)` assim que o `)` e digitado. */
export function markdownLinkAtCaret() {
  const ctx = caretTextNode();
  if (!ctx) return false;

  const before = ctx.node.textContent.slice(0, ctx.offset);
  const match = before.match(MARKDOWN_LINK);
  if (!match) return false;

  const href = safeHref(match[2]);
  if (!href) return false;

  replaceRange(
    ctx.node,
    ctx.offset - match[0].length,
    ctx.offset,
    makeAnchor(href, match[1]),
    0
  );
  return true;
}

/** O <a> que contem a selecao atual, se houver. */
export function anchorInSelection() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const node = sel.getRangeAt(0).commonAncestorContainer;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return el?.closest?.('a') ?? null;
}

/** Aplica (ou atualiza) um link sobre um Range guardado. */
export function applyLink(range, { text, href }) {
  const anchor = makeAnchor(href, text);
  range.deleteContents();
  range.insertNode(anchor);

  const sel = window.getSelection();
  const after = document.createRange();
  after.setStartAfter(anchor);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  return anchor;
}

export function unwrapAnchor(anchor) {
  const text = document.createTextNode(anchor.textContent);
  anchor.replaceWith(text);
  return text;
}
