/**
 * Undo/redo por snapshot do estado inteiro da pagina.
 *
 * A alternativa seria guardar a operacao inversa de cada acao ("criei o bloco X,
 * entao desfazer = apagar X"). Com 13 tipos de bloco, merge, split e reorder,
 * isso vira uma matriz de casos especiais. Aqui a gente so guarda como a pagina
 * estava e reescreve tudo — o servidor aplica em uma transacao unica.
 *
 * O custo e proporcional ao tamanho da pagina, nao ao numero de acoes, e para
 * paginas de anotacao isso e barato.
 */
export class History {
  constructor({ limit = 80 } = {}) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  clear() {
    this.past = [];
    this.future = [];
  }

  /** Chamado ANTES de mutar: guarda como esta agora e invalida o redo. */
  record(snapshot) {
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }

  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
