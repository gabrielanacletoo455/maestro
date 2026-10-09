/**
 * Gerencia a aparencia do app.
 *
 * Existem dois conceitos distintos aqui:
 *  - `mode`     e a PREFERENCIA do usuario: 'light' | 'dark' | 'system'
 *  - `resolved` e o tema EFETIVO aplicado no DOM: 'light' | 'dark'
 *
 * Sao a mesma coisa nos dois primeiros modos, mas em 'system' o resolvido
 * depende do SO e pode mudar sozinho com a aba aberta.
 */
const STORAGE_KEY = 'themeMode';
const LEGACY_KEY = 'theme';
const MODES = ['light', 'dark', 'system'];

const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export const THEME_MODES = [
  { id: 'light', label: 'Claro', desc: 'Sempre claro' },
  { id: 'dark', label: 'Escuro', desc: 'Sempre escuro' },
  { id: 'system', label: 'Automatico', desc: 'Segue o sistema' },
];

function readMode() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (MODES.includes(stored)) return stored;

  // Migracao da versao anterior, que guardava so 'light' | 'dark' em 'theme'.
  const legacy = localStorage.getItem(LEGACY_KEY);
  return MODES.includes(legacy) ? legacy : 'system';
}

export const theme = {
  get mode() {
    return readMode();
  },

  get resolved() {
    const mode = readMode();
    return mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
  },

  set(mode) {
    if (!MODES.includes(mode)) return;
    localStorage.setItem(STORAGE_KEY, mode);
    localStorage.removeItem(LEGACY_KEY);
    theme.apply();
  },

  apply() {
    const mode = readMode();
    const resolved = theme.resolved;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
    for (const fn of listeners) fn({ mode, resolved });
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// So repinta quando a preferencia e 'system' — nos outros modos o SO nao manda.
media.addEventListener('change', () => {
  if (readMode() === 'system') theme.apply();
});
