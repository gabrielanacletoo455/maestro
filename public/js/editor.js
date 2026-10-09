import { api } from './api.js';
import { BLOCK_TYPES, SLASH_COMMANDS, markdownTypeFor, filterCommands } from './blockTypes.js';
import { SlashMenu, FormatToolbar, EmojiPicker, LinkEditor } from './menus.js';
import { History } from './history.js';
import {
  autolinkAtCaret,
  markdownLinkAtCaret,
  anchorInSelection,
  applyLink,
  unwrapAnchor,
  safeHref,
} from './links.js';

const CONTINUABLE = new Set(
  Object.entries(BLOCK_TYPES).filter(([, m]) => m.continues).map(([t]) => t)
);

export class Editor {
  constructor(root, { onPageChanged, onOpenPage }) {
    this.root = root;
    this.onPageChanged = onPageChanged;
    this.onOpenPage = onOpenPage;
    this.page = null;
    this.blocks = [];
    this.saveTimers = new Map();
    this.slash = new SlashMenu();
    this.toolbar = new FormatToolbar();
    this.emoji = new EmojiPicker();
    this.linkEditor = new LinkEditor();
    this.history = new History();
    this.dragId = null;
    this.typing = { key: null, at: 0 };
    this.selected = new Set();
    this.selecting = null;

    document.addEventListener('selectionchange', () => this.syncToolbar());
    this.wireBlockSelection();
  }

  /* --------------------------------- render -------------------------------- */

  async load(pageId) {
    await this.flushAll();
    this.history.clear();
    this.typing = { key: null, at: 0 };
    this.page = await api.page(pageId);
    this.blocks = this.page.blocks;
    this.render();
  }

  clear() {
    this.page = null;
    this.blocks = [];
    this.root.innerHTML = `
      <div class="empty-state">
        <div>Nenhuma pagina aberta</div>
        <button id="empty-new">Criar uma pagina</button>
      </div>`;
    this.root.querySelector('#empty-new')?.addEventListener('click', () =>
      this.onPageChanged?.({ action: 'create' })
    );
  }

  render() {
    const p = this.page;
    this.root.innerHTML = `
      <article class="page">
        ${p.cover ? `<div class="page__cover" style="background-image:url('${p.cover}')"></div>` : ''}
        <header class="page__header ${p.cover ? 'has-cover' : ''}">
          <div class="page__icon" id="page-icon">${p.icon || '📄'}</div>
          <h1 class="page__title" id="page-title" contenteditable
              spellcheck="false">${escapeHtml(p.title)}</h1>
        </header>
        <div class="blocks" id="blocks"></div>
      </article>`;

    const title = this.root.querySelector('#page-title');
    title.addEventListener('input', () => {
      this.recordTyping('__title__');
      const value = title.textContent.trim();
      this.page.title = value;
      this.queueSave('title', () =>
        api.updatePage(p.id, { title: value }).then((updated) => {
          this.onPageChanged?.({ action: 'meta', page: updated });
        })
      );
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.focusBlock(this.blocks[0]?.id) || this.appendBlock();
      }
      if (e.key === 'ArrowDown' && !e.shiftKey) {
        e.preventDefault();
        this.focusBlock(this.blocks[0]?.id);
      }
    });
    title.addEventListener('paste', plainTextPaste);

    this.root.querySelector('#page-icon').addEventListener('click', (e) => {
      this.emoji.open(e.currentTarget, async (icon) => {
        this.record();
        const updated = await api.updatePage(p.id, { icon });
        this.page.icon = icon;
        this.root.querySelector('#page-icon').textContent = icon;
        this.onPageChanged?.({ action: 'meta', page: updated });
      });
    });

    this.list = this.root.querySelector('#blocks');
    this.wireFileDrop();
    this.renderBlocks();
  }

  renderBlocks() {
    this.selected.clear();
    this.list.innerHTML = '';
    let numberCounter = 0;
    for (const block of this.blocks) {
      if (block.type === 'numbered') numberCounter += 1;
      else numberCounter = 0;
      this.list.append(this.buildBlock(block, numberCounter));
    }
    if (!this.blocks.length) this.appendBlock();
  }

  buildBlock(block, index) {
    const meta = BLOCK_TYPES[block.type] ?? BLOCK_TYPES.paragraph;
    const el = document.createElement('div');
    el.className = `block block--${block.type}`;
    el.dataset.id = block.id;
    if (block.type === 'todo' && block.props.checked) el.classList.add('is-done');

    el.innerHTML = `
      <div class="block__gutter">
        <button class="icon-btn" data-act="add" title="Inserir abaixo">＋</button>
        <button class="icon-btn block__handle" data-act="menu" draggable="true"
                title="Arrastar / opcoes">⠿</button>
      </div>
      <div class="block__marker">${this.markerFor(block, index)}</div>
      <div class="block__content" ${meta.void ? '' : 'contenteditable spellcheck="false"'}
           data-placeholder="${meta.placeholder ?? ''}"></div>`;

    const content = el.querySelector('.block__content');
    if (!meta.void) content.innerHTML = block.content;
    if (block.type === 'image') this.renderImage(block, content);
    if (block.type === 'subpage') {
      content.textContent = block.content || 'Sem titulo';
      content.addEventListener('click', () => block.props.pageId && this.onOpenPage(block.props.pageId));
    }

    this.wireBlock(el, block, content);
    return el;
  }

  markerFor(block, index) {
    if (block.type === 'numbered') return `${index}.`;
    if (block.type === 'todo') {
      return `<input type="checkbox" ${block.props.checked ? 'checked' : ''} />`;
    }
    if (block.type === 'callout') return block.props.emoji || '💡';
    if (block.type === 'subpage') return '📄';
    return '';
  }

  wireBlock(el, block, content) {
    el.querySelector('[data-act="add"]').addEventListener('click', () =>
      this.insertAfter(block.id)
    );

    const handle = el.querySelector('[data-act="menu"]');
    handle.addEventListener('click', (e) => this.openBlockMenu(e.currentTarget, block));
    handle.addEventListener('dragstart', (e) => {
      this.dragId = block.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', block.id);
    });
    handle.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      this.dragId = null;
      this.list.querySelectorAll('.block').forEach((b) =>
        b.classList.remove('drop-above', 'drop-below')
      );
    });

    el.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === block.id) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const below = e.clientY > rect.top + rect.height / 2;
      el.classList.toggle('drop-below', below);
      el.classList.toggle('drop-above', !below);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const below = el.classList.contains('drop-below');
      el.classList.remove('drop-above', 'drop-below');
      this.moveBlock(this.dragId, block.id, below);
    });

    el.querySelector('input[type="checkbox"]')?.addEventListener('change', (e) => {
      this.record();
      block.props.checked = e.target.checked;
      el.classList.toggle('is-done', e.target.checked);
      api.updateBlock(block.id, { props: block.props });
    });

    if (BLOCK_TYPES[block.type]?.void) return;

    content.addEventListener('focus', () => el.classList.add('is-focused'));
    content.addEventListener('blur', () => {
      el.classList.remove('is-focused');
      this.flush(block.id);
    });
    content.addEventListener('paste', (e) => this.handlePaste(e, block));
    content.addEventListener('input', () => this.handleInput(block, content));
    content.addEventListener('keydown', (e) => this.handleKeydown(e, block, content));
    content.addEventListener('mouseup', () => this.syncToolbar());
    content.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (!anchor || e.altKey) return; // Alt+clique posiciona o cursor para editar
      e.preventDefault();
      window.open(anchor.href, '_blank', 'noopener,noreferrer');
    });
  }

  /* ---------------------------- selecao de blocos --------------------------- */

  /**
   * Cada bloco e um contenteditable separado, e a selecao nativa nao atravessa
   * essa fronteira. Quando o arraste sai do bloco onde comecou, troca para
   * selecao de blocos inteiros (como no Notion).
   */
  wireBlockSelection() {
    this.root.addEventListener('mousedown', (e) => {
      this.clearSelection();
      if (e.button !== 0 || !this.list) return;
      if (e.target.closest('button, input, a, img, .page__header')) return;
      const start = this.blockAt(e.clientY);
      if (start) this.selecting = { startId: start.dataset.id, active: false };
    });

    document.addEventListener('mousemove', (e) => {
      const s = this.selecting;
      if (!s) return;
      if (!(e.buttons & 1)) return this.endSelecting();
      const over = this.blockAt(e.clientY);
      if (!s.active) {
        if (!over || over.dataset.id === s.startId) return;
        s.active = true;
        document.activeElement?.blur?.();
        this.root.classList.add('is-block-selecting');
      }
      window.getSelection()?.removeAllRanges();
      if (over) this.selectRange(s.startId, over.dataset.id);
      this.autoScroll(e.clientY);
    });

    document.addEventListener('mouseup', () => this.endSelecting());
    document.addEventListener('keydown', (e) => this.handleSelectionKeys(e), true);

    document.addEventListener('copy', (e) => {
      if (!this.selected.size) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', this.selectionText());
    });
    document.addEventListener('cut', (e) => {
      if (!this.selected.size) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', this.selectionText());
      this.deleteSelected();
    });
  }

  endSelecting() {
    this.selecting = null;
    this.root.classList.remove('is-block-selecting');
  }

  blockAt(y) {
    const els = [...(this.list?.children ?? [])];
    if (!els.length) return null;
    if (y < els[0].getBoundingClientRect().top) return els[0];
    return els.find((el) => y <= el.getBoundingClientRect().bottom) ?? els.at(-1);
  }

  selectRange(fromId, toId) {
    const a = this.blocks.findIndex((b) => b.id === fromId);
    const b = this.blocks.findIndex((b) => b.id === toId);
    if (a < 0 || b < 0) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    this.setSelected(this.blocks.slice(lo, hi + 1).map((block) => block.id));
  }

  setSelected(ids) {
    this.selected = new Set(ids);
    for (const el of this.list.children) {
      el.classList.toggle('is-selected', this.selected.has(el.dataset.id));
    }
  }

  clearSelection() {
    if (!this.selected.size) return;
    this.selected.clear();
    this.list?.querySelectorAll('.block.is-selected').forEach((el) =>
      el.classList.remove('is-selected')
    );
  }

  autoScroll(y) {
    const scroller = this.root.closest('#scroller') ?? document.querySelector('#scroller');
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (y < rect.top + 40) scroller.scrollBy(0, -20);
    else if (y > rect.bottom - 40) scroller.scrollBy(0, 20);
  }

  handleSelectionKeys(e) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    // Cmd/Ctrl+A: primeiro seleciona o texto do bloco; com ele ja todo
    // selecionado (ou vazio), o segundo seleciona todos os blocos.
    if (mod && key === 'a' && this.page) {
      const content = document.activeElement?.closest?.('.block__content');
      const sel = window.getSelection();
      const whole = content && sel.toString().length >= content.textContent.length;
      if (this.selected.size || whole) {
        e.preventDefault();
        document.activeElement?.blur?.();
        sel?.removeAllRanges();
        this.setSelected(this.blocks.map((b) => b.id));
      }
      return;
    }

    if (!this.selected.size || mod) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.clearSelection();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      this.deleteSelected();
    } else if (!['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) {
      this.clearSelection();
    }
  }

  selectionText() {
    let n = 0;
    return this.blocks
      .filter((b) => this.selected.has(b.id))
      .map((b) => {
        n = b.type === 'numbered' ? n + 1 : 0;
        const text = stripTags(b.content);
        if (b.type === 'divider') return '---';
        if (b.type === 'numbered') return `${n}. ${text}`;
        if (b.type === 'todo') return `- [${b.props.checked ? 'x' : ' '}] ${text}`;
        const prefix = { heading1: '# ', heading2: '## ', heading3: '### ', bulleted: '- ', quote: '> ' };
        return (prefix[b.type] ?? '') + text;
      })
      .join('\n');
  }

  async deleteSelected() {
    const ids = [...this.selected];
    if (!ids.length) return;
    const first = this.blocks.findIndex((b) => this.selected.has(b.id));
    this.record();
    for (const id of ids) {
      clearTimeout(this.saveTimers.get(id)?.timer);
      this.saveTimers.delete(id);
    }
    this.blocks = this.blocks.filter((b) => !this.selected.has(b.id));
    this.selected.clear();
    await Promise.all(ids.map((id) => api.deleteBlock(id)));
    if (!this.blocks.length) return this.appendBlock();
    this.renderBlocks();
    this.focusBlock(this.blocks[Math.max(0, first - 1)].id, 'end');
  }

  /* --------------------------------- input --------------------------------- */

  handleInput(block, content) {
    const text = content.textContent;
    this.recordTyping(block.id);

    // Links: `[nome](url)` fecha na hora, URL crua vira link ao digitar espaco.
    if (block.type !== 'code' && (markdownLinkAtCaret() || autolinkAtCaret())) {
      block.content = content.innerHTML;
      this.queueSave(block.id, () => api.updateBlock(block.id, { content: block.content }));
      return;
    }

    if (block.type !== 'code') {
      const nextType = markdownTypeFor(text);
      if (nextType && nextType !== block.type) {
        content.textContent = '';
        this.changeType(block.id, nextType);
        return;
      }
    }

    if (text.endsWith('/') && caretAtEnd(content)) {
      this.openSlash(block, content);
    } else if (this.slash.isOpen) {
      const query = slashQuery(content);
      if (query === null) this.slash.close();
      else this.slash.filter(query);
    }

    block.content = content.innerHTML;
    this.queueSave(block.id, () => api.updateBlock(block.id, { content: block.content }));
  }

  handleKeydown(e, block, content) {
    if (this.slash.isOpen && this.slash.handleKey(e)) return;

    const mod = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl+K com texto selecionado vira "criar link" (fora disso e a busca).
    if (mod && e.key.toLowerCase() === 'k' && !window.getSelection()?.isCollapsed) {
      e.preventDefault();
      this.openLinkEditor();
      return;
    }

    if (mod && ['b', 'i', 'e', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const cmd = { b: 'bold', i: 'italic', u: 'underline', e: 'code' }[e.key.toLowerCase()];
      this.applyFormat(cmd);
      this.flushSoon(block, content);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (block.type === 'code') return; // no codigo, Enter quebra linha
      e.preventDefault();
      const text = content.textContent.trim();

      // Enter em item de lista vazio sai da lista em vez de criar outro.
      if (CONTINUABLE.has(block.type) && !text) {
        this.changeType(block.id, 'paragraph');
        return;
      }

      const inherit = CONTINUABLE.has(block.type) ? block.type : 'paragraph';
      const tail = splitAtCaret(content);
      block.content = content.innerHTML;
      this.queueSave(block.id, () => api.updateBlock(block.id, { content: block.content }));
      this.insertAfter(block.id, { type: inherit, content: tail });
      return;
    }

    if (e.key === 'Backspace' && caretAtStart(content)) {
      const index = this.blocks.findIndex((b) => b.id === block.id);
      if (block.type !== 'paragraph') {
        e.preventDefault();
        this.changeType(block.id, 'paragraph');
        return;
      }
      if (index > 0) {
        e.preventDefault();
        this.mergeBackwards(index);
      }
      return;
    }

    if (e.key === 'ArrowUp' && caretAtStart(content)) {
      e.preventDefault();
      const index = this.blocks.findIndex((b) => b.id === block.id);
      if (index === 0) this.root.querySelector('#page-title')?.focus();
      else this.focusBlock(this.blocks[index - 1].id, 'end');
    }

    if (e.key === 'ArrowDown' && caretAtEnd(content)) {
      const index = this.blocks.findIndex((b) => b.id === block.id);
      if (index < this.blocks.length - 1) {
        e.preventDefault();
        this.focusBlock(this.blocks[index + 1].id, 'start');
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  }

  /* -------------------------------- mutations ------------------------------- */

  async insertAfter(afterId, { type = 'paragraph', content = '' } = {}) {
    this.record();
    const created = await api.createBlock(this.page.id, { afterId, type, content });
    const index = this.blocks.findIndex((b) => b.id === afterId);
    this.blocks.splice(index + 1, 0, created);
    this.renderBlocks();
    this.focusBlock(created.id, 'start');
  }

  async appendBlock() {
    const last = this.blocks.at(-1)?.id ?? null;
    const created = await api.createBlock(this.page.id, { afterId: last });
    this.blocks.push(created);
    this.renderBlocks();
    this.focusBlock(created.id);
  }

  async changeType(id, type) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block) return;
    this.record();

    if (type === 'subpage') {
      const page = await api.createPage({ parentId: this.page.id, title: 'Sem titulo' });
      block.props = { pageId: page.id };
      block.content = 'Sem titulo';
      await api.updateBlock(id, { type, content: block.content, props: block.props });
      block.type = type;
      this.renderBlocks();
      this.onPageChanged?.({ action: 'tree' });
      return;
    }

    block.type = type;
    if (type === 'divider') block.content = '';
    await api.updateBlock(id, { type, content: block.content });
    this.renderBlocks();
    if (!BLOCK_TYPES[type].void) this.focusBlock(id, 'end');
    else if (type === 'image') this.pickImageFor(id);
    else this.insertAfter(id);
  }

  async removeBlock(id) {
    const index = this.blocks.findIndex((b) => b.id === id);
    if (index < 0) return;
    this.record();
    this.blocks.splice(index, 1);
    await api.deleteBlock(id);
    if (!this.blocks.length) return this.appendBlock();
    this.renderBlocks();
    this.focusBlock(this.blocks[Math.max(0, index - 1)].id, 'end');
  }

  async mergeBackwards(index) {
    this.record();
    const current = this.blocks[index];
    const previous = this.blocks[index - 1];
    if (BLOCK_TYPES[previous.type]?.void) return this.removeBlock(previous.id);

    const merged = previous.content + current.content;
    previous.content = merged;
    this.blocks.splice(index, 1);
    await Promise.all([
      api.updateBlock(previous.id, { content: merged }),
      api.deleteBlock(current.id),
    ]);
    this.renderBlocks();
    this.focusBlock(previous.id, 'end');
  }

  async moveBlock(sourceId, targetId, below) {
    const from = this.blocks.findIndex((b) => b.id === sourceId);
    if (from < 0) return;
    this.record();
    const [moved] = this.blocks.splice(from, 1);
    let to = this.blocks.findIndex((b) => b.id === targetId);
    if (below) to += 1;
    this.blocks.splice(to, 0, moved);
    this.renderBlocks();
    await api.reorderBlocks(this.page.id, this.blocks.map((b) => b.id));
  }

  /* --------------------------------- imagens -------------------------------- */

  renderImage(block, content) {
    const { url, name } = block.props;

    if (!url) {
      content.innerHTML = `<button class="image-empty">🖼️ Adicionar uma imagem</button>`;
      content
        .querySelector('.image-empty')
        .addEventListener('click', () => this.pickImageFor(block.id));
      return;
    }

    content.innerHTML = `
      <figure class="image-figure">
        <img src="${url}" alt="${escapeHtml(name ?? '')}" loading="lazy" />
        <button class="image-replace" title="Trocar imagem">Trocar</button>
        <figcaption class="image-caption" contenteditable spellcheck="false"
                    data-placeholder="Escreva uma legenda"></figcaption>
      </figure>`;

    content.querySelector('.image-replace').addEventListener('click', () =>
      this.pickImageFor(block.id)
    );

    // A legenda vive em block.content — assim ela entra no indice de busca.
    const caption = content.querySelector('.image-caption');
    caption.textContent = stripTags(block.content);
    caption.addEventListener('input', () => {
      block.content = caption.textContent;
      this.queueSave(block.id, () => api.updateBlock(block.id, { content: block.content }));
    });
    caption.addEventListener('blur', () => this.flush(block.id));
  }

  pickImageFor(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.attachImage(id, file);
    });
    input.click();
  }

  async attachImage(id, file) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block) return;
    this.record();
    try {
      const asset = await api.uploadImage(file);
      block.props = { ...block.props, url: asset.url, name: asset.name };
      await api.updateBlock(id, { props: block.props });
      // Se a imagem ficou por ultimo, garante uma linha depois para continuar escrevendo.
      if (this.blocks.at(-1)?.id === id) await this.appendBlock();
      else this.renderBlocks();
    } catch (err) {
      alert(err.message);
    }
  }

  async insertImageAfter(afterId, file) {
    const created = await api.createBlock(this.page.id, { afterId, type: 'image' });
    const index = this.blocks.findIndex((b) => b.id === afterId);
    this.blocks.splice(index + 1, 0, created);
    this.renderBlocks();
    await this.attachImage(created.id, file);
  }

  handlePaste(e, block) {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      return this.insertImageAfter(block.id, file);
    }

    // Colar uma URL com texto selecionado transforma a selecao em link,
    // em vez de trocar o texto pelo endereco.
    const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
    const selection = window.getSelection();
    const href = text.includes(' ') ? null : safeHref(text);
    if (href && selection?.rangeCount && !selection.isCollapsed && block.type !== 'code') {
      e.preventDefault();
      this.record();
      const range = selection.getRangeAt(0);
      applyLink(range, { text: range.toString(), href });
      const content = this.list.querySelector(`.block[data-id="${block.id}"] .block__content`);
      block.content = content.innerHTML;
      this.queueSave(block.id, () => api.updateBlock(block.id, { content: block.content }));
      return;
    }

    plainTextPaste(e);
  }

  wireFileDrop() {
    this.list.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
    });
    this.list.addEventListener('drop', async (e) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) =>
        f.type.startsWith('image/')
      );
      if (!files.length) return;
      e.preventDefault();
      let anchor = e.target.closest('.block')?.dataset.id ?? this.blocks.at(-1)?.id;
      for (const file of files) {
        await this.insertImageAfter(anchor, file);
        anchor = this.blocks[this.blocks.findIndex((b) => b.id === anchor) + 1]?.id ?? anchor;
      }
    });
  }

  /* ---------------------------------- menus --------------------------------- */

  openSlash(block, content) {
    const anchorRect = caretRect(content);
    this.slash.open({
      commands: SLASH_COMMANDS,
      filterFn: filterCommands,
      rect: anchorRect,
      onPick: (command) => {
        const text = content.textContent;
        const slashAt = text.lastIndexOf('/');
        content.textContent = text.slice(0, slashAt);
        block.content = content.innerHTML;
        api.updateBlock(block.id, { content: block.content });
        this.changeType(block.id, command.type);
      },
    });
  }

  openBlockMenu(anchor, block) {
    const actions = [
      { glyph: '🗑️', label: 'Excluir', run: () => this.removeBlock(block.id) },
      {
        glyph: '📋',
        label: 'Duplicar',
        run: () => this.insertAfter(block.id, { type: block.type, content: block.content }),
      },
      ...SLASH_COMMANDS.filter((c) => c.type !== block.type && c.type !== 'subpage').map((c) => ({
        glyph: c.glyph,
        label: `Transformar em ${c.label}`,
        run: () => this.changeType(block.id, c.type),
      })),
    ];
    this.slash.openActions(actions, anchor.getBoundingClientRect());
  }

  applyFormat(command) {
    if (command === 'link') return this.openLinkEditor();
    if (command === 'code') return wrapInlineCode();
    document.execCommand(command, false, null);
  }

  openLinkEditor() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;

    const existing = anchorInSelection();
    const blockEl = (existing ?? selection.anchorNode?.parentElement)?.closest?.('.block');
    if (!blockEl) return;

    // O Range some quando o input do popover recebe foco — por isso guardamos.
    const range = selection.getRangeAt(0).cloneRange();
    if (existing) range.selectNode(existing);

    const commit = () => {
      const content = blockEl.querySelector('.block__content');
      const block = this.blocks.find((b) => b.id === blockEl.dataset.id);
      if (!block) return;
      block.content = content.innerHTML;
      this.queueSave(block.id, () => api.updateBlock(block.id, { content: block.content }));
      this.toolbar.hide();
    };

    this.linkEditor.open({
      rect: range.getBoundingClientRect(),
      text: existing ? existing.textContent : range.toString(),
      href: existing?.getAttribute('href') ?? '',
      canRemove: Boolean(existing),
      onApply: ({ text, href }) => {
        const safe = safeHref(href);
        if (!safe) return alert('Endereco invalido. Use http://, https:// ou um e-mail.');
        this.record();
        applyLink(range, { text: text || safe, href: safe });
        commit();
      },
      onRemove: () => {
        if (!existing) return;
        this.record();
        unwrapAnchor(existing);
        commit();
      },
    });
  }

  syncToolbar() {
    const selection = window.getSelection();
    const inBlock = selection?.anchorNode?.parentElement?.closest?.('.block__content');
    if (!selection || selection.isCollapsed || !inBlock) return this.toolbar.hide();

    this.toolbar.show(selection.getRangeAt(0).getBoundingClientRect(), (command) => {
      this.applyFormat(command);
      const id = inBlock.closest('.block').dataset.id;
      const block = this.blocks.find((b) => b.id === id);
      if (!block) return;
      block.content = inBlock.innerHTML;
      this.queueSave(id, () => api.updateBlock(id, { content: block.content }));
    });
  }

  /* -------------------------------- historico ------------------------------- */

  snapshot() {
    return {
      title: this.page.title,
      icon: this.page.icon,
      blocks: this.blocks.map((b) => ({
        id: b.id,
        type: b.type,
        content: b.content,
        props: { ...b.props },
      })),
    };
  }

  record() {
    if (this.page) this.history.record(this.snapshot());
  }

  /**
   * Digitar nao pode empilhar um snapshot por tecla. Agrupa em "rajadas":
   * um novo ponto de undo so nasce ao trocar de bloco ou depois de uma pausa.
   */
  recordTyping(key) {
    const now = Date.now();
    if (this.typing.key !== key || now - this.typing.at > 1200) this.record();
    this.typing = { key, at: now };
  }

  async undo() {
    const target = this.history.undo(this.snapshot());
    if (!target) return false;
    await this.applySnapshot(target);
    return true;
  }

  async redo() {
    const target = this.history.redo(this.snapshot());
    if (!target) return false;
    await this.applySnapshot(target);
    return true;
  }

  async applySnapshot(snap) {
    // Cancela (nao descarrega) o autosave pendente: senao ele sobrescreveria
    // o estado restaurado com o que estava na tela um instante atras.
    this.cancelPending();
    this.typing = { key: null, at: 0 };

    if (snap.title !== this.page.title || snap.icon !== this.page.icon) {
      await api.updatePage(this.page.id, { title: snap.title, icon: snap.icon });
    }
    const page = await api.replaceBlocks(this.page.id, snap.blocks);

    this.page = page;
    this.blocks = page.blocks;
    this.render();
    this.onPageChanged?.({ action: 'meta', page });
  }

  /* --------------------------------- saving --------------------------------- */

  queueSave(key, fn) {
    clearTimeout(this.saveTimers.get(key)?.timer);
    const timer = setTimeout(() => {
      this.saveTimers.delete(key);
      fn();
    }, 400);
    this.saveTimers.set(key, { timer, fn });
  }

  flush(key) {
    const entry = this.saveTimers.get(key);
    if (!entry) return Promise.resolve();
    clearTimeout(entry.timer);
    this.saveTimers.delete(key);
    return Promise.resolve(entry.fn());
  }

  cancelPending() {
    for (const { timer } of this.saveTimers.values()) clearTimeout(timer);
    this.saveTimers.clear();
  }

  /** Cmd/Ctrl+S: descarrega tudo que estava no debounce e espera terminar. */
  async saveNow() {
    const pending = this.saveTimers.size;
    await this.flushAll();
    return pending;
  }

  flushSoon(block, content) {
    block.content = content.innerHTML;
    this.queueSave(block.id, () => api.updateBlock(block.id, { content: block.content }));
  }

  flushAll() {
    return Promise.all([...this.saveTimers.keys()].map((key) => this.flush(key)));
  }

  /* ---------------------------------- focus --------------------------------- */

  focusBlock(id, where = 'end') {
    if (!id) return false;
    const el = this.list?.querySelector(`.block[data-id="${id}"] .block__content`);
    if (!el || !el.isContentEditable) return false;
    el.focus();
    placeCaret(el, where);
    return true;
  }
}

/* ------------------------------ DOM helpers -------------------------------- */

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function stripTags(html) {
  const el = document.createElement('div');
  el.innerHTML = String(html ?? '');
  return el.textContent;
}

function plainTextPaste(e) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
}

function caretAtStart(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return range.toString().length === 0;
}

function caretAtEnd(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length === 0;
}

function splitAtCaret(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return '';
  const range = sel.getRangeAt(0);
  const tail = range.cloneRange();
  tail.selectNodeContents(el);
  tail.setStart(range.endContainer, range.endOffset);
  const fragment = tail.extractContents();
  const holder = document.createElement('div');
  holder.append(fragment);
  return holder.innerHTML;
}

function placeCaret(el, where) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(where === 'start');
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretRect(fallbackEl) {
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height || rect.top) return rect;
  }
  return fallbackEl.getBoundingClientRect();
}

function slashQuery(content) {
  const text = content.textContent;
  const at = text.lastIndexOf('/');
  if (at < 0) return null;
  const query = text.slice(at + 1);
  return query.length > 20 ? null : query;
}

function wrapInlineCode() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const inside = range.startContainer.parentElement?.closest('code');
  if (inside) {
    inside.replaceWith(...inside.childNodes); // toggle off
    return;
  }
  const code = document.createElement('code');
  code.append(range.extractContents());
  range.insertNode(code);
}
