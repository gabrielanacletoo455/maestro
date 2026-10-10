// Memoria do Claude: na primeira vez pergunta se o dev quer importar as conversas
// antigas; depois mostra o andamento no rodape da sidebar e abre a revisao dos resumos.
import { toast } from './overlays.js';

const get = (url) => fetch(url).then((r) => r.json());
const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

const esc = (t) =>
  String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mil = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} milhões` : `${Math.max(1, Math.round(n / 1e3))} mil`);

function modal(html, { largo = false } = {}) {
  const fundo = document.createElement('div');
  fundo.className = 'overlay';
  const painel = document.createElement('div');
  painel.className = `settings memoria${largo ? ' memoria--larga' : ''}`;
  painel.innerHTML = html;
  fundo.append(painel);
  const fechar = () => {
    fundo.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && fechar();
  fundo.addEventListener('mousedown', (e) => e.target === fundo && fechar());
  document.addEventListener('keydown', onKey);
  document.body.append(fundo);
  painel.querySelector('[data-act="close"]')?.addEventListener('click', fechar);
  return { painel, fechar };
}

/* ----------------------------- primeira vez ------------------------------ */

export async function perguntarImportacao({ forcar = false } = {}) {
  let info;
  try {
    info = await get('/api/maestro/boas-vindas');
  } catch {
    return;
  }
  if (!info.perguntar && !forcar) return;
  if (!info.todas.conversas) {
    if (forcar) toast('Nenhuma conversa nova do Claude Code para importar.');
    return;
  }

  const horas = (n) => Math.max(1, Math.ceil(n / info.porHora));
  const { painel, fechar } = modal(`
    <header class="settings__header">
      <span>📥 Trazer suas conversas do Claude para o Maestro?</span>
      <button class="icon-btn" data-act="close" title="Fechar">✕</button>
    </header>
    <div class="settings__body">
      <p class="memoria__texto">
        Encontrei <b>${info.todas.conversas} conversas</b> suas no Claude Code. O Maestro pode ler cada uma,
        guardar <b>só o que vale lembrar</b> (decisões, o que alguém disse, causa de bugs, pendências) e jogar fora o resto.
      </p>
      <ul class="memoria__lista">
        <li>Nada entra nas suas páginas sem você aprovar: os resumos ficam esperando revisão.</li>
        <li>Roda em segundo plano, ${info.porHora} conversas por hora, e pausa sozinho se o limite do seu plano apertar.</li>
        <li>Senhas, tokens, CPF/CNPJ, e-mails e telefones são removidos antes de gravar.</li>
      </ul>
      <div class="memoria__opcoes">
        <button class="memoria__opcao" data-escolha="todas">
          <b>Importar tudo</b>
          <span>${info.todas.conversas} conversas · ~${mil(info.todas.tokens)} tokens do Haiku · ~${horas(info.todas.conversas)}h</span>
        </button>
        <button class="memoria__opcao" data-escolha="recentes" ${info.recentes.conversas ? '' : 'disabled'}>
          <b>Só os últimos 30 dias</b>
          <span>${info.recentes.conversas} conversas · ~${mil(info.recentes.tokens)} tokens · ~${horas(info.recentes.conversas)}h</span>
        </button>
        <button class="memoria__opcao memoria__opcao--nao" data-escolha="nao">
          <b>Agora não</b>
          <span>Dá para importar depois em Configurações.</span>
        </button>
      </div>
    </div>`);

  painel.querySelectorAll('[data-escolha]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const escolha = btn.dataset.escolha;
      await post('/api/maestro/importacao/responder', { escolha });
      fechar();
      if (escolha === 'nao') toast('Tudo bem. Você pode importar depois em Configurações.');
      else {
        toast('Importação começou. Acompanhe no rodapé da barra lateral.');
        atualizarIndicador();
      }
    })
  );
}

/* ------------------------- indicador na sidebar -------------------------- */

let indicador = null;

export function iniciarMemoria() {
  const rodape = document.querySelector('.sidebar__footer');
  if (!rodape) return;
  indicador = document.createElement('div');
  indicador.className = 'nav-item nav-item--action memoria__indicador';
  indicador.hidden = true;
  indicador.addEventListener('click', abrirRevisao);
  rodape.prepend(indicador);
  atualizarIndicador();
  setInterval(atualizarIndicador, 60000);
  perguntarImportacao();
}

async function atualizarIndicador() {
  if (!indicador) return;
  let s;
  try {
    s = await get('/api/maestro/status');
  } catch {
    return;
  }
  const partes = [];
  if (s.precisaLogin) partes.push('⚠️ Claude sem login');
  if (s.fila) partes.push(`importando (${s.fila} na fila)`);
  if (s.pendentes) partes.push(`${s.pendentes} para revisar`);
  indicador.hidden = !partes.length;
  indicador.textContent = `📥 ${partes.join(' · ')}`;
  indicador.title = s.precisaLogin
    ? 'O Maestro precisa do Claude de terminal logado para resumir as conversas. Clique para ver como.'
    : 'Clique para revisar os resumos importados';
}

/* -------------------------------- revisao -------------------------------- */

const NOMES = {
  descricao: 'Descrição', codigo: 'Código', commits: 'Commits', permissoes: 'Permissões', feito: 'Feito',
  figma: 'Figma', conversas: 'Conversas', backend: 'Backend', duvidas: 'Dúvidas', pendencias: 'Pendências',
  licoes: 'Lições', review: 'Review', historico: 'Histórico', validacao: 'Validação', resolucao: 'Resolução',
};

export async function abrirRevisao() {
  const [s, pendentes] = await Promise.all([get('/api/maestro/status'), get('/api/maestro/importacao/pendentes')]);

  const avisoLogin = s.precisaLogin
    ? `<div class="memoria__aviso">
         ⚠️ Para o Maestro resumir as conversas, o Claude de terminal precisa estar logado.
         Abra o terminal, rode <code>claude</code>, digite <code>/login</code> e siga o navegador. Só precisa uma vez.
       </div>`
    : '';
  const andamento = s.fila
    ? `<p class="memoria__texto">Ainda faltam <b>${s.fila}</b> conversas para ler (${s.porHora} por hora).${s.pausaAte ? ` Pausado até ${new Date(s.pausaAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : ''}</p>`
    : '';

  const itens = pendentes
    .map((p) => {
      const c = p.contexto;
      const quando = new Date(c.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      const destino = /^(feature|feat|bugfix|fix|hotfix)\//.test(c.branch ?? '') ? 'página da task' : 'Diário';
      const secoes = Object.entries(p.resumo.secoes ?? {})
        .map(([k, v]) => [k, k === 'feito' ? v?.itens ?? [] : Array.isArray(v) ? v : []])
        .filter(([, v]) => v.length)
        .map(([k, v]) => `<div class="memoria__secao"><b>${esc(NOMES[k] ?? k)}</b><ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`)
        .join('');
      return `
        <label class="memoria__item">
          <input type="checkbox" data-id="${esc(p.id)}" checked />
          <div>
            <div class="memoria__titulo">${esc(p.resumo.titulo || 'Sem título')}</div>
            <div class="memoria__meta">${esc(quando)} · ${esc(c.projeto)} · ${esc(c.branch || 'sem branch')} → ${destino}</div>
            ${p.resumo.resumo ? `<div class="memoria__resumo">${esc(p.resumo.resumo)}</div>` : ''}
            <details><summary>ver o que será gravado</summary>${secoes}</details>
          </div>
        </label>`;
    })
    .join('');

  const { painel, fechar } = modal(
    `
    <header class="settings__header">
      <span>📥 Revisar importação</span>
      <button class="icon-btn" data-act="close" title="Fechar">✕</button>
    </header>
    <div class="settings__body">
      ${avisoLogin}${andamento}
      ${pendentes.length
        ? `<p class="memoria__texto">Marque o que deve virar nota. O resto é descartado.</p><div class="memoria__itens">${itens}</div>`
        : '<p class="memoria__texto">Nenhum resumo esperando revisão.</p>'}
    </div>
    ${pendentes.length
      ? `<footer class="memoria__rodape">
           <button class="settings__btn" data-act="descartar">Descartar selecionados</button>
           <button class="settings__btn settings__btn--primario" data-act="aprovar">Gravar selecionados nas notas</button>
         </footer>`
      : ''}`,
    { largo: true }
  );

  const selecionados = () => [...painel.querySelectorAll('input[data-id]:checked')].map((i) => i.dataset.id);
  painel.querySelector('[data-act="aprovar"]')?.addEventListener('click', async () => {
    const ids = selecionados();
    if (!ids.length) return toast('Nada selecionado.');
    const r = await post('/api/maestro/importacao/aprovar', { indices: ids });
    fechar();
    toast(`${r.length} resumo(s) gravado(s) nas notas.`);
    atualizarIndicador();
    window.dispatchEvent(new CustomEvent('maestro:notas-mudaram'));
  });
  painel.querySelector('[data-act="descartar"]')?.addEventListener('click', async () => {
    const ids = selecionados();
    if (!ids.length) return toast('Nada selecionado.');
    const r = await post('/api/maestro/importacao/descartar', { indices: ids });
    fechar();
    toast(`${r.descartados} resumo(s) descartado(s).`);
    atualizarIndicador();
  });
}
