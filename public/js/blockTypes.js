/**
 * Registro unico de tipos de bloco.
 * Cada entrada alimenta tres coisas ao mesmo tempo: a renderizacao no editor,
 * o menu de barra ("/") e os atalhos de markdown.
 */
export const BLOCK_TYPES = {
  paragraph: {
    label: 'Texto',
    desc: 'Comece a escrever com texto simples.',
    glyph: 'Aa',
    keywords: ['texto', 'paragrafo', 'p', 'text'],
    placeholder: '',
  },
  heading1: {
    label: 'Titulo 1',
    desc: 'Titulo de secao grande.',
    glyph: 'H1',
    keywords: ['h1', 'titulo', 'heading', 'header'],
    markdown: /^#\s$/,
    placeholder: 'Titulo 1',
  },
  heading2: {
    label: 'Titulo 2',
    desc: 'Titulo de secao medio.',
    glyph: 'H2',
    keywords: ['h2', 'subtitulo', 'heading'],
    markdown: /^##\s$/,
    placeholder: 'Titulo 2',
  },
  heading3: {
    label: 'Titulo 3',
    desc: 'Titulo de secao pequeno.',
    glyph: 'H3',
    keywords: ['h3', 'subtitulo', 'heading'],
    markdown: /^###\s$/,
    placeholder: 'Titulo 3',
  },
  bulleted: {
    label: 'Lista com marcadores',
    desc: 'Cria uma lista simples.',
    glyph: '•',
    keywords: ['lista', 'bullet', 'ul', 'marcador'],
    markdown: /^[-*+]\s$/,
    placeholder: 'Item',
    continues: true,
  },
  numbered: {
    label: 'Lista numerada',
    desc: 'Cria uma lista ordenada.',
    glyph: '1.',
    keywords: ['lista', 'numerada', 'ol', 'numero'],
    markdown: /^\d+\.\s$/,
    placeholder: 'Item',
    continues: true,
  },
  todo: {
    label: 'Lista de tarefas',
    desc: 'Acompanhe tarefas com checkbox.',
    glyph: '☑',
    keywords: ['todo', 'tarefa', 'checkbox', 'check'],
    markdown: /^\[\]\s$|^\[ \]\s$/,
    placeholder: 'Tarefa',
    continues: true,
  },
  quote: {
    label: 'Citacao',
    desc: 'Destaque uma citacao.',
    glyph: '❝',
    keywords: ['citacao', 'quote', 'blockquote'],
    markdown: /^>\s$/,
    placeholder: 'Citacao',
  },
  callout: {
    label: 'Destaque',
    desc: 'Chame atencao com um aviso.',
    glyph: '💡',
    keywords: ['destaque', 'callout', 'aviso', 'info'],
    placeholder: 'Escreva algo...',
  },
  code: {
    label: 'Codigo',
    desc: 'Bloco de codigo monoespacado.',
    glyph: '</>',
    keywords: ['codigo', 'code', 'snippet'],
    markdown: /^```$/,
    placeholder: 'Cole seu codigo',
  },
  image: {
    label: 'Imagem',
    desc: 'Envie uma imagem do seu computador.',
    glyph: '🖼️',
    keywords: ['imagem', 'image', 'foto', 'picture', 'upload', 'png', 'jpg'],
    void: true,
  },
  divider: {
    label: 'Divisor',
    desc: 'Separa visualmente o conteudo.',
    glyph: '—',
    keywords: ['divisor', 'divider', 'linha', 'hr'],
    markdown: /^---$/,
    void: true,
  },
  subpage: {
    label: 'Sub-pagina',
    desc: 'Cria uma pagina aninhada aqui.',
    glyph: '📄',
    keywords: ['pagina', 'page', 'sub', 'subpagina'],
    void: true,
  },
};

export const SLASH_COMMANDS = Object.entries(BLOCK_TYPES).map(([type, meta]) => ({
  type,
  ...meta,
}));

/** Casa o texto digitado contra os atalhos de markdown. Retorna o tipo ou null. */
export function markdownTypeFor(text) {
  for (const [type, meta] of Object.entries(BLOCK_TYPES)) {
    if (meta.markdown?.test(text)) return type;
  }
  return null;
}

/**
 * Filtra e ordena os comandos do menu "/" conforme o usuario digita.
 *
 * @param {string} query   texto depois da barra, ja em minusculas e sem espacos nas pontas
 * @param {Array}  commands  lista de SLASH_COMMANDS ({ type, label, desc, keywords, glyph })
 * @returns {Array} subconjunto de `commands`, na ordem em que sera exibido
 */
export function filterCommands(query, commands) {
  // TODO(human)
}
