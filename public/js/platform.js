/** Mac usa Cmd, Windows/Linux usam Ctrl — a tecla e a mesma no codigo, o rotulo nao. */
// Case-insensitive de proposito: userAgentData.platform devolve "macOS" (m minusculo),
// enquanto o navigator.platform antigo devolve "MacIntel".
export const IS_MAC = /mac|iphone|ipad|ipod/i.test(
  navigator.userAgentData?.platform || navigator.platform || navigator.userAgent
);

export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
export const SHIFT_LABEL = IS_MAC ? '⇧' : 'Shift+';

/** shortcut('K') -> '⌘K' no Mac, 'Ctrl+K' no resto. */
export const shortcut = (key, { shift = false } = {}) =>
  `${MOD_LABEL}${shift ? SHIFT_LABEL : ''}${key}`;

/** true quando Cmd (Mac) ou Ctrl (resto) esta pressionado. */
export const isMod = (e) => (IS_MAC ? e.metaKey : e.ctrlKey) || e.metaKey || e.ctrlKey;
