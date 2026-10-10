// Filtro de dados sensiveis: roda no servidor antes de gravar qualquer texto escrito
// pela IA. Mesmo que o resumo erre, segredo e dado pessoal nao chegam ao banco.

const REGRAS = [
  // tokens e chaves conhecidos
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, '[REMOVIDO:jwt]'],
  [/\bBearer\s+[\w\-.~+/]{12,}=*/gi, 'Bearer [REMOVIDO]'],
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}\b/g, '[REMOVIDO:chave]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '[REMOVIDO:token-github]'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, '[REMOVIDO:token-github]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REMOVIDO:chave-aws]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REMOVIDO:chave-google]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[REMOVIDO:token-slack]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REMOVIDO:chave-privada]'],
  // usuario:senha dentro de URL / connection string
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, '$1[REMOVIDO]@'],
  // atribuicoes do tipo senha=..., token: "..."
  [
    /\b(password|passwd|senha|secret|segredo|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key|private[_-]?key)(\s*[:=]\s*)(["']?)[^\s"',;]{4,}\3/gi,
    '$1$2$3[REMOVIDO]$3',
  ],
  // documentos e contato
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REMOVIDO:cpf]'],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[REMOVIDO:cnpj]'],
  [/(?<![\w.\/-])\d{11}(?![\w-])/g, '[REMOVIDO:numero]'],
  [/(?<![\w.\/-])\d{14}(?![\w-])/g, '[REMOVIDO:numero]'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REMOVIDO:email]'],
  [/(?:\+55\s?)?\(?\b\d{2}\)?\s?9\d{4}-?\d{4}\b/g, '[REMOVIDO:telefone]'],
];

export function limpar(texto) {
  let saida = String(texto ?? '');
  let removidos = 0;
  for (const [re, troca] of REGRAS) {
    saida = saida.replace(re, (...args) => {
      removidos += 1;
      return typeof troca === 'string' ? troca.replace(/\$(\d)/g, (_, n) => args[Number(n)] ?? '') : troca;
    });
  }
  return { texto: saida, removidos };
}

/** Aplica o filtro em todas as strings de um objeto (resumo inteiro). */
export function limparTudo(valor) {
  let total = 0;
  const visitar = (v) => {
    if (typeof v === 'string') {
      const { texto, removidos } = limpar(v);
      total += removidos;
      return texto;
    }
    if (Array.isArray(v)) return v.map(visitar);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visitar(x)]));
    return v;
  };
  return { valor: visitar(valor), removidos: total };
}
