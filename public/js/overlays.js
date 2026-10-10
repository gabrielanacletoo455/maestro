import { api } from './api.js';
import { theme, THEME_MODES } from './theme.js';
import { perguntarImportacao, abrirRevisao } from './memoria.js';

function overlay(inner, onClose) {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.append(inner);
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  el.addEventListener('mousedown', (e) => e.target === el && close());
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  return { el, close };
}

export function openSearch(onOpenPage) {
  const panel = document.createElement('div');
  panel.className = 'search';
  panel.innerHTML = `
    <input type="text" placeholder="Buscar em todas as paginas..." autofocus />
    <div class="search__results"></div>`;

  const { close } = overlay(panel);
  const input = panel.querySelector('input');
  const results = panel.querySelector('.search__results');
  let items = [];
  let cursor = 0;
  let debounce;

  const paint = () => {
    if (!items.length) {
      results.innerHTML = input.value.trim()
        ? '<div class="menu__empty">Nada encontrado</div>'
        : '<div class="menu__empty">Digite para buscar</div>';
      return;
    }
    results.innerHTML = items
      .map(
        (item, i) => `
        <div class="search__item ${i === cursor ? 'is-active' : ''}" data-i="${i}">
          <span>${item.icon || '📄'}</span>
          <span class="menu__label">
            <span>${item.title}</span>
            ${item.excerpt ? `<span class="search__excerpt">${item.excerpt}</span>` : ''}
          </span>
        </div>`
      )
      .join('');
    results.querySelectorAll('.search__item').forEach((node) =>
      node.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(Number(node.dataset.i));
      })
    );
  };

  const pick = (i) => {
    const item = items[i];
    if (!item) return;
    close();
    onOpenPage(item.pageId);
  };

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      items = input.value.trim() ? await api.search(input.value) : [];
      cursor = 0;
      paint();
    }, 120);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), (cursor = (cursor + 1) % items.length), paint());
    if (e.key === 'ArrowUp')
      (e.preventDefault(), (cursor = (cursor - 1 + items.length) % items.length), paint());
    if (e.key === 'Enter') (e.preventDefault(), pick(cursor));
  });

  paint();
  setTimeout(() => input.focus(), 0);
}

export async function openTrash(onChanged) {
  const rows = await api.trash();
  const panel = document.createElement('div');
  panel.className = 'search';
  panel.innerHTML = `
    <input type="text" placeholder="Buscar na lixeira..." />
    <div class="search__results"></div>`;

  const { close } = overlay(panel);
  const input = panel.querySelector('input');
  const results = panel.querySelector('.search__results');

  const paint = () => {
    const term = input.value.toLowerCase();
    const visible = rows.filter((r) => (r.title || '').toLowerCase().includes(term));
    if (!visible.length) {
      results.innerHTML = '<div class="menu__empty">A lixeira esta vazia</div>';
      return;
    }
    results.innerHTML = visible
      .map(
        (r) => `
        <div class="search__item" data-id="${r.id}">
          <span>${r.icon || '📄'}</span>
          <span class="menu__label" style="flex:1">
            <span>${r.title || 'Sem titulo'}</span>
            <span class="search__excerpt">Excluida em ${r.deleted_at}</span>
          </span>
          <button class="topbar__btn" data-act="restore">Restaurar</button>
          <button class="topbar__btn" data-act="purge">Excluir</button>
        </div>`
      )
      .join('');

    results.querySelectorAll('[data-act]').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.closest('[data-id]').dataset.id;
        if (btn.dataset.act === 'restore') await api.restorePage(id);
        else {
          if (!confirm('Excluir permanentemente? Isso nao pode ser desfeito.')) return;
          await api.purgePage(id);
        }
        close();
        onChanged();
      })
    );
  };

  input.addEventListener('input', paint);
  paint();
  setTimeout(() => input.focus(), 0);
}

export function toast(message, actionLabel, onAction) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${message}</span>`;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      el.remove();
      onAction?.();
    });
    el.append(btn);
  }
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}

export function openSettings() {
  const panel = document.createElement('div');
  panel.className = 'settings';
  panel.innerHTML = `
    <header class="settings__header">
      <span>Configuracoes</span>
      <button class="icon-btn" data-act="close" title="Fechar">✕</button>
    </header>
    <div class="settings__body">
      <section class="settings__section">
        <div class="settings__label">Aparencia</div>
        <div class="settings__hint">Como o app deve se parecer neste dispositivo.</div>
        <div class="theme-options">
          ${THEME_MODES.map(
            (mode) => `
            <button class="theme-card" data-mode="${mode.id}">
              <span class="theme-preview theme-preview--${mode.id}">
                ${previewMarkup()}
                ${mode.id === 'system' ? `<span class="theme-preview__overlay">${previewMarkup()}</span>` : ''}
              </span>
              <span class="theme-card__label">${mode.label}</span>
              <span class="theme-card__desc">${mode.desc}</span>
            </button>`
          ).join('')}
        </div>
      </section>

      <section class="settings__section">
        <div class="settings__label">Memória do Claude</div>
        <div class="settings__hint">
          O Claude anota sozinho o que você faz nas conversas do Claude Code e lembra disso depois.
        </div>
        <div class="settings__row">
          <div class="menu__label">
            <span>Importar conversas antigas</span>
            <span class="menu__desc">Lê as conversas que você já teve e guarda só o que vale lembrar, para você revisar.</span>
          </div>
          <button class="settings__btn" data-act="importar">Importar…</button>
        </div>
        <div class="settings__row">
          <div class="menu__label">
            <span>Revisar importação</span>
            <span class="menu__desc">Resumos esperando sua aprovação antes de virar nota.</span>
          </div>
          <button class="settings__btn" data-act="revisar">Revisar</button>
        </div>
      </section>

      <section class="settings__section">
        <div class="settings__label">Dados</div>
        <div class="settings__hint">
          Tudo fica em <code>data/anotacoes.db</code>; as imagens em <code>data/uploads/</code>.
        </div>
        <div class="settings__row">
          <div class="menu__label">
            <span>Exportar workspace</span>
            <span class="menu__desc" id="export-summary">Um unico JSON com paginas, blocos e imagens.</span>
          </div>
          <button class="settings__btn" data-act="export">Baixar JSON</button>
        </div>
        <label class="settings__check">
          <input type="checkbox" id="export-assets" checked />
          Embutir as imagens no JSON (base64)
        </label>
        <label class="settings__check">
          <input type="checkbox" id="export-trash" checked />
          Incluir paginas da lixeira
        </label>
      </section>
    </div>`;

  // O painel escuta o tema (o SO pode mudar sozinho no modo automatico), entao
  // precisa cancelar a assinatura em QUALQUER saida: X, Esc ou clique no fundo.
  const unsubscribe = theme.onChange(() => paintSelection());
  const { close } = overlay(panel, unsubscribe);
  panel.querySelector('[data-act="close"]').addEventListener('click', close);

  const paintSelection = () => {
    panel.querySelectorAll('.theme-card').forEach((card) =>
      card.classList.toggle('is-selected', card.dataset.mode === theme.mode)
    );
  };

  panel.querySelectorAll('.theme-card').forEach((card) =>
    card.addEventListener('click', () => {
      theme.set(card.dataset.mode);
      paintSelection();
    })
  );

  panel.querySelector('[data-act="importar"]').addEventListener('click', () => {
    close();
    perguntarImportacao({ forcar: true });
  });
  panel.querySelector('[data-act="revisar"]').addEventListener('click', () => {
    close();
    abrirRevisao();
  });

  panel.querySelector('[data-act="export"]').addEventListener('click', () => {
    const assets = panel.querySelector('#export-assets').checked ? '1' : '0';
    const trash = panel.querySelector('#export-trash').checked ? '1' : '0';
    // O navegador cuida do download: a rota ja responde com Content-Disposition.
    const link = document.createElement('a');
    link.href = `/api/export?assets=${assets}&trash=${trash}`;
    link.download = '';
    link.click();
    toast('Exportando workspace...');
  });

  paintSelection();
}

function previewMarkup() {
  return `<span class="theme-preview__side"></span>
    <span class="theme-preview__main"><i></i><i></i><i></i></span>`;
}
