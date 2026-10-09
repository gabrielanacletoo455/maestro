import { shortcut } from './platform.js';

const EMOJIS = [
  '📄','📝','📌','📎','📁','🗂️','📚','📖','🔖','🏷️','💡','🔥','⭐','🌟','✨','⚡','🎯','🎨',
  '🚀','🧠','🛠️','🔧','⚙️','🧩','🔍','📊','📈','📉','💰','💳','🧾','📅','⏰','⏳','✅','☑️',
  '❌','⚠️','❗','❓','💬','📣','🔔','🏠','🏢','🌍','🌱','🍀','🐙','🦊','🐝','☕','🍕','🎧',
];

function positionNear(el, rect) {
  el.style.visibility = 'hidden';
  document.body.append(el);
  const box = el.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - box.width - 12);
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow > box.height + 12 ? rect.bottom + 6 : rect.top - box.height - 6;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
  el.style.visibility = 'visible';
}

/** Menu do "/" e tambem o menu de acoes do bloco (mesma casca visual). */
export class SlashMenu {
  constructor() {
    this.el = null;
    this.items = [];
    this.cursor = 0;
    this.onPick = null;
    this.filterFn = null;
    this.commands = [];
    this.dismiss = (e) => {
      if (this.el && !this.el.contains(e.target)) this.close();
    };
  }

  get isOpen() {
    return Boolean(this.el);
  }

  open({ commands, filterFn, rect, onPick }) {
    this.close();
    this.commands = commands;
    this.filterFn = filterFn;
    this.onPick = onPick;
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = '<div class="menu__hint">Blocos basicos</div><div class="menu__list"></div>';
    positionNear(this.el, rect);
    this.filter('');
    setTimeout(() => document.addEventListener('mousedown', this.dismiss), 0);
  }

  openActions(actions, rect) {
    this.close();
    this.onPick = (item) => item.run();
    this.filterFn = null;
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = '<div class="menu__list"></div>';
    positionNear(this.el, rect);
    this.paint(actions);
    setTimeout(() => document.addEventListener('mousedown', this.dismiss), 0);
  }

  filter(query) {
    const normalized = String(query).toLowerCase().trim();
    const result = this.filterFn?.(normalized, this.commands);
    this.paint(Array.isArray(result) ? result : this.commands);
  }

  paint(items) {
    if (!this.el) return;
    this.items = items;
    this.cursor = 0;
    const list = this.el.querySelector('.menu__list');

    if (!items.length) {
      list.innerHTML = '<div class="menu__empty">Nenhum bloco encontrado</div>';
      return;
    }

    list.innerHTML = items
      .map(
        (item, i) => `
        <div class="menu__item ${i === 0 ? 'is-active' : ''}" data-i="${i}">
          <span class="menu__glyph">${item.glyph ?? '·'}</span>
          <span class="menu__label">
            <span>${item.label}</span>
            ${item.desc ? `<span class="menu__desc">${item.desc}</span>` : ''}
          </span>
        </div>`
      )
      .join('');

    list.querySelectorAll('.menu__item').forEach((node) => {
      node.addEventListener('mouseenter', () => this.move(Number(node.dataset.i), true));
      node.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.pick(Number(node.dataset.i));
      });
    });
  }

  move(index, absolute = false) {
    if (!this.items.length) return;
    this.cursor = absolute
      ? index
      : (this.cursor + index + this.items.length) % this.items.length;
    const nodes = this.el.querySelectorAll('.menu__item');
    nodes.forEach((n, i) => n.classList.toggle('is-active', i === this.cursor));
    nodes[this.cursor]?.scrollIntoView({ block: 'nearest' });
  }

  pick(index) {
    const item = this.items[index ?? this.cursor];
    this.close();
    if (item) this.onPick?.(item);
  }

  /** Retorna true quando consumiu a tecla. */
  handleKey(e) {
    if (!this.isOpen) return false;
    if (e.key === 'ArrowDown') return e.preventDefault(), this.move(1), true;
    if (e.key === 'ArrowUp') return e.preventDefault(), this.move(-1), true;
    if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), this.pick(), true;
    if (e.key === 'Escape') return e.preventDefault(), this.close(), true;
    return false;
  }

  close() {
    document.removeEventListener('mousedown', this.dismiss);
    this.el?.remove();
    this.el = null;
    this.items = [];
  }
}

export class FormatToolbar {
  constructor() {
    this.el = null;
  }

  show(rect, onCommand) {
    if (!rect.width && !rect.height) return this.hide();
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'toolbar';
      this.el.innerHTML = `
        <button data-cmd="bold" title="Negrito (${shortcut('B')})"><b>B</b></button>
        <button data-cmd="italic" title="Italico (${shortcut('I')})"><i>i</i></button>
        <button data-cmd="underline" title="Sublinhado (${shortcut('U')})"><u>U</u></button>
        <button data-cmd="strikeThrough" title="Riscado"><s>S</s></button>
        <button data-cmd="code" title="Codigo (${shortcut('E')})">&lt;/&gt;</button>
        <button data-cmd="link" title="Link (${shortcut('K')})">🔗</button>`;
      this.el.addEventListener('mousedown', (e) => {
        const cmd = e.target.closest('button')?.dataset.cmd;
        if (!cmd) return;
        e.preventDefault();
        this.onCommand?.(cmd);
      });
      document.body.append(this.el);
    }
    this.onCommand = onCommand;
    const box = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.max(8, rect.left + rect.width / 2 - box.width / 2)}px`;
    this.el.style.top = `${Math.max(8, rect.top - box.height - 8)}px`;
  }

  hide() {
    this.el?.remove();
    this.el = null;
  }
}

export class EmojiPicker {
  open(anchor, onPick) {
    const el = document.createElement('div');
    el.className = 'menu';
    el.innerHTML = `
      <div class="menu__hint">Icone da pagina</div>
      <div class="emoji-grid">
        ${EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('')}
      </div>`;
    positionNear(el, anchor.getBoundingClientRect());

    const close = () => {
      el.remove();
      document.removeEventListener('mousedown', outside);
    };
    const outside = (e) => {
      if (!el.contains(e.target)) close();
    };

    el.addEventListener('click', (e) => {
      const emoji = e.target.dataset.e;
      if (!emoji) return;
      onPick(emoji);
      close();
    });
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
  }
}

/**
 * Popover de link: deixa dar um nome ao link em vez de mostrar a URL crua.
 * Guarda o Range da selecao porque focar o input tira a selecao do bloco.
 */
export class LinkEditor {
  open({ rect, text = '', href = '', canRemove = false, onApply, onRemove }) {
    this.close();

    const el = document.createElement('div');
    el.className = 'menu link-editor';
    el.innerHTML = `
      <label class="link-editor__field">
        <span>Texto</span>
        <input type="text" data-field="text" placeholder="Nome do link" />
      </label>
      <label class="link-editor__field">
        <span>URL</span>
        <input type="text" data-field="href" placeholder="cole ou digite o endereco" />
      </label>
      <div class="link-editor__actions">
        ${canRemove ? '<button data-act="remove" class="link-editor__remove">Remover</button>' : ''}
        <span style="flex:1"></span>
        <button data-act="cancel">Cancelar</button>
        <button data-act="apply" class="link-editor__apply">Aplicar</button>
      </div>`;

    positionNear(el, rect);
    this.el = el;

    const inputs = {
      text: el.querySelector('[data-field="text"]'),
      href: el.querySelector('[data-field="href"]'),
    };
    inputs.text.value = text;
    inputs.href.value = href;

    const submit = () => {
      const value = { text: inputs.text.value.trim(), href: inputs.href.value.trim() };
      if (!value.href) return inputs.href.focus();
      this.close();
      onApply(value);
    };

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (e.preventDefault(), submit());
      if (e.key === 'Escape') (e.preventDefault(), this.close());
      e.stopPropagation(); // nao deixa o atalho global capturar o que se digita aqui
    });

    el.querySelector('[data-act="apply"]').addEventListener('click', submit);
    el.querySelector('[data-act="cancel"]').addEventListener('click', () => this.close());
    el.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
      this.close();
      onRemove?.();
    });

    this.dismiss = (e) => {
      if (!el.contains(e.target)) this.close();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this.dismiss);
      (href || !text ? inputs.href : inputs.text).focus();
      inputs.href.select?.();
    }, 0);
  }

  close() {
    if (this.dismiss) document.removeEventListener('mousedown', this.dismiss);
    this.el?.remove();
    this.el = null;
  }
}
