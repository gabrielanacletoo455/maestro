import { api } from './api.js';

export class Sidebar {
  constructor({ onOpen, onCreate, onTreeChanged }) {
    this.treeEl = document.querySelector('#tree');
    this.favEl = document.querySelector('#favorites');
    this.favSection = document.querySelector('#favorites-section');
    this.onOpen = onOpen;
    this.onCreate = onCreate;
    this.onTreeChanged = onTreeChanged;
    this.activeId = null;
    this.dragId = null;
    this.expanded = new Set(JSON.parse(localStorage.getItem('expanded') ?? '[]'));
  }

  async refresh() {
    const { tree, favorites } = await api.sidebar();
    this.tree = tree;
    this.treeEl.innerHTML = '';
    if (!tree.length) {
      this.treeEl.innerHTML = '<div class="tree-empty">Nenhuma pagina ainda</div>';
    } else {
      tree.forEach((node) => this.treeEl.append(this.buildNode(node)));
    }

    this.favSection.hidden = !favorites.length;
    this.favEl.innerHTML = '';
    for (const fav of favorites) {
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.innerHTML = `<span class="tree-row__caret empty"></span>
        <span class="tree-row__icon">${fav.icon || '📄'}</span>
        <span class="tree-row__title">${escapeHtml(fav.title) || 'Sem titulo'}</span>`;
      row.addEventListener('click', () => this.onOpen(fav.id));
      this.favEl.append(row);
    }
  }

  setActive(id) {
    this.activeId = id;
    this.treeEl.querySelectorAll('.tree-row').forEach((row) =>
      row.classList.toggle('is-active', row.dataset.id === id)
    );
  }

  /** Abre todos os ancestrais para revelar a pagina no tree. */
  reveal(breadcrumb = []) {
    for (const crumb of breadcrumb.slice(0, -1)) this.expanded.add(crumb.id);
    this.persist();
  }

  buildNode(node) {
    const wrapper = document.createElement('div');
    const hasKids = node.children.length > 0;
    const isOpen = this.expanded.has(node.id);

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.id = node.id;
    if (node.id === this.activeId) row.classList.add('is-active');
    row.draggable = true;
    row.innerHTML = `
      <button class="tree-row__caret ${hasKids ? '' : 'empty'} ${isOpen ? 'open' : ''}">▶</button>
      <span class="tree-row__icon">${node.icon || '📄'}</span>
      <span class="tree-row__title">${escapeHtml(node.title) || 'Sem titulo'}</span>
      <span class="tree-row__actions">
        <button class="icon-btn" data-act="add" title="Adicionar sub-pagina">＋</button>
        <button class="icon-btn" data-act="del" title="Mover para lixeira">🗑️</button>
      </span>`;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.tree-row__caret') || e.target.closest('[data-act]')) return;
      this.onOpen(node.id);
    });

    row.querySelector('.tree-row__caret').addEventListener('click', () => {
      if (!hasKids) return;
      this.expanded.has(node.id) ? this.expanded.delete(node.id) : this.expanded.add(node.id);
      this.persist();
      this.refresh();
    });

    row.querySelector('[data-act="add"]').addEventListener('click', async () => {
      this.expanded.add(node.id);
      this.persist();
      await this.onCreate(node.id);
    });

    row.querySelector('[data-act="del"]').addEventListener('click', async () => {
      await api.deletePage(node.id);
      this.onTreeChanged?.(node.id);
    });

    row.addEventListener('dragstart', (e) => {
      this.dragId = node.id;
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === node.id) return;
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drop-target');
      const moved = this.dragId;
      this.dragId = null;
      if (!moved || moved === node.id) return;
      try {
        await api.updatePage(moved, { parent_id: node.id });
        this.expanded.add(node.id);
        this.persist();
        this.refresh();
      } catch (err) {
        alert(err.message);
      }
    });

    wrapper.append(row);

    if (hasKids && isOpen) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      node.children.forEach((child) => children.append(this.buildNode(child)));
      wrapper.append(children);
    }
    return wrapper;
  }

  persist() {
    localStorage.setItem('expanded', JSON.stringify([...this.expanded]));
  }
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}
