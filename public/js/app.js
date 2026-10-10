import { api } from './api.js';
import { Editor } from './editor.js';
import { Sidebar } from './sidebar.js';
import { openSearch, openTrash, openSettings, toast } from './overlays.js';
import { theme } from './theme.js';
import { shortcut } from './platform.js';
import { iniciarMemoria } from './memoria.js';

const $ = (sel) => document.querySelector(sel);

const state = { pageId: null };

const editor = new Editor($('#page-root'), {
  onPageChanged: ({ action, page }) => {
    if (action === 'create') return createPage(null);
    if (action === 'meta') {
      sidebar.refresh();
      renderTopbar(page);
    }
    if (action === 'tree') sidebar.refresh();
  },
  onOpenPage: (id) => openPage(id),
});

const sidebar = new Sidebar({
  onOpen: (id) => openPage(id),
  onCreate: (parentId) => createPage(parentId),
  onTreeChanged: async (deletedId) => {
    await sidebar.refresh();
    toast('Pagina movida para a lixeira', 'Desfazer', async () => {
      await api.restorePage(deletedId);
      await sidebar.refresh();
    });
    if (deletedId === state.pageId) await openFirstAvailable();
  },
});

/* ---------------------------------- rotas ---------------------------------- */

async function openPage(id, { push = true } = {}) {
  if (!id) return editor.clear();
  try {
    await editor.load(id);
  } catch {
    return openFirstAvailable();
  }
  state.pageId = id;
  sidebar.reveal(editor.page.breadcrumb);
  await sidebar.refresh();
  sidebar.setActive(id);
  renderTopbar(editor.page);
  localStorage.setItem('lastPage', id);
  if (push && location.hash !== `#${id}`) history.pushState({ id }, '', `#${id}`);
}

async function createPage(parentId = null) {
  const page = await api.createPage({ parentId, title: '' });
  await sidebar.refresh();
  await openPage(page.id);
  $('#page-title')?.focus();
}

async function openFirstAvailable() {
  const { tree } = await api.sidebar();
  if (tree.length) return openPage(tree[0].id);
  state.pageId = null;
  editor.clear();
  renderTopbar(null);
}

function renderTopbar(page) {
  const crumbs = $('#breadcrumb');
  if (!page) {
    crumbs.innerHTML = '';
    $('#btn-favorite').hidden = true;
    $('#btn-delete').hidden = true;
    return;
  }
  $('#btn-favorite').hidden = false;
  $('#btn-delete').hidden = false;

  const trail = page.breadcrumb ?? editor.page?.breadcrumb ?? [];
  crumbs.innerHTML = trail
    .map(
      (c, i) =>
        `${i ? '<span class="breadcrumb__sep">/</span>' : ''}
         <button class="breadcrumb__item" data-id="${c.id}">${c.icon || '📄'} ${
           c.title || 'Sem titulo'
         }</button>`
    )
    .join('');
  crumbs.querySelectorAll('.breadcrumb__item').forEach((b) =>
    b.addEventListener('click', () => openPage(b.dataset.id))
  );

  const fav = $('#btn-favorite');
  fav.textContent = page.favorite ? '★' : '☆';
  fav.classList.toggle('is-on', Boolean(page.favorite));
}

/* --------------------------------- eventos --------------------------------- */

$('#btn-new-page').addEventListener('click', () => createPage(null));
$('#btn-search').addEventListener('click', () => openSearch(openPage));
$('#btn-trash').addEventListener('click', () =>
  openTrash(async () => {
    await sidebar.refresh();
    if (state.pageId) openPage(state.pageId).catch(openFirstAvailable);
  })
);

$('#btn-favorite').addEventListener('click', async () => {
  const next = editor.page.favorite ? 0 : 1;
  const updated = await api.updatePage(editor.page.id, { favorite: next });
  editor.page.favorite = next;
  renderTopbar(updated);
  sidebar.refresh();
});

$('#btn-delete').addEventListener('click', async () => {
  const id = editor.page.id;
  await api.deletePage(id);
  await sidebar.refresh();
  toast('Pagina movida para a lixeira', 'Desfazer', async () => {
    await api.restorePage(id);
    await sidebar.refresh();
    openPage(id);
  });
  await openFirstAvailable();
});

const toggleSidebar = () => {
  const collapsed = $('#sidebar').classList.toggle('collapsed');
  $('#btn-expand').hidden = !collapsed;
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '');
};
$('#btn-collapse').addEventListener('click', toggleSidebar);

// Largura da sidebar: arrastar a borda direita ajusta, duplo clique volta ao padrao.
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 560;
const resizer = $('#sidebar-resizer');
resizer.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add('is-resizing-sidebar');
  const left = $('#sidebar').getBoundingClientRect().left;
  let width = null;

  const move = (ev) => {
    width = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX - left)));
    document.documentElement.style.setProperty('--sidebar-w', `${width}px`);
  };
  const up = () => {
    document.body.classList.remove('is-resizing-sidebar');
    resizer.removeEventListener('pointermove', move);
    resizer.removeEventListener('pointerup', up);
    resizer.removeEventListener('pointercancel', up);
    if (width === null) return;
    try {
      localStorage.setItem('sidebarWidth', String(width));
    } catch {}
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up);
  resizer.addEventListener('pointercancel', up);
});
resizer.addEventListener('dblclick', () => {
  document.documentElement.style.removeProperty('--sidebar-w');
  try {
    localStorage.removeItem('sidebarWidth');
  } catch {}
});
$('#btn-expand').addEventListener('click', toggleSidebar);

$('#btn-settings').addEventListener('click', () => openSettings());
$('#workspace').addEventListener('click', () => openSettings());

$('#scroller').addEventListener('scroll', (e) =>
  $('#topbar').classList.toggle('scrolled', e.target.scrollTop > 8)
);

document.addEventListener('keydown', async (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const key = e.key.toLowerCase();

  // Cmd/Ctrl+S: o autosave ja cobre tudo, mas salvar na mao tranquiliza.
  if (key === 's') {
    e.preventDefault();
    if (!editor.page) return;
    const pending = await editor.saveNow();
    toast(pending ? 'Alteracoes salvas' : 'Tudo ja estava salvo');
    return;
  }

  // Undo / redo. No Windows, Ctrl+Y tambem refaz.
  if (key === 'z' || key === 'y') {
    if (!editor.page) return;
    e.preventDefault();
    const isRedo = key === 'y' || e.shiftKey;
    const changed = isRedo ? await editor.redo() : await editor.undo();
    if (!changed) toast(isRedo ? 'Nada para refazer' : 'Nada para desfazer');
    return;
  }

  // Com texto selecionado dentro de um bloco, Cmd/Ctrl+K vira "criar link".
  if (key === 'k') {
    const selection = window.getSelection();
    const inBlock = selection?.anchorNode?.parentElement?.closest?.('.block__content');
    if (inBlock && !selection.isCollapsed) return; // o editor trata
    e.preventDefault();
    openSearch(openPage);
    return;
  }

  if (e.key === '\\') (e.preventDefault(), toggleSidebar());
  if (e.shiftKey && key === 'n') (e.preventDefault(), createPage(null));
  if (e.key === ',') (e.preventDefault(), openSettings());
});

window.addEventListener('popstate', () => {
  const id = location.hash.slice(1);
  if (id && id !== state.pageId) openPage(id, { push: false });
});

window.addEventListener('beforeunload', () => editor.flushAll());

/* ----------------------------------- boot ---------------------------------- */

// Rotulos dos atalhos mudam entre Mac e Windows/Linux.
for (const el of document.querySelectorAll('[data-shortcut]')) {
  el.textContent = shortcut(el.dataset.shortcut, { shift: el.dataset.shortcutShift === '1' });
}
for (const el of document.querySelectorAll('[data-shortcut-title]')) {
  el.title = el.title.replace('{mod}', shortcut(el.dataset.shortcutTitle));
}

(async function boot() {
  theme.apply();
  iniciarMemoria();
  window.addEventListener('maestro:notas-mudaram', () => sidebar.refresh());

  if (localStorage.getItem('sidebarCollapsed')) toggleSidebar();

  await sidebar.refresh();
  const target = location.hash.slice(1) || localStorage.getItem('lastPage');
  if (target) await openPage(target, { push: false }).catch(openFirstAvailable);
  else await openFirstAvailable();
})();
