# CLAUDE.md — Maestro

App de anotacoes local de cada dev (estilo Notion) + memoria do Claude Code.
Leia antes de qualquer tarefa. As notas aqui sao trabalho real e insubstituivel:
**na duvida, pergunte antes de agir.**

## Como o projeto funciona

| Parte | Onde |
|---|---|
| Servidor (Node, sem framework, sem dependencias) | `src/server.js` |
| Banco SQLite (`node:sqlite`) — **fonte da verdade** | `data/anotacoes.db` |
| Acesso ao banco | `src/repo.js` |
| Imagens enviadas | `data/uploads/` |
| Backups automaticos (a cada 15 min se algo mudou; tudo das ultimas 48h + 1 por dia para sempre) | `data/backups/` |
| Espelho em Markdown, regenerado apos cada alteracao | `notas-md/` (`src/mirror.js` + `src/markdown.js`) |
| Busca local sem IA (comando `maestro`) | `maestro/maestro.js`, `maestro/cli.js` |
| Lembretes automaticos (hooks do Claude Code) | `maestro/lembretes.js`, `maestro/hooks/` |
| Skill do Claude Code | `maestro/skill/SKILL.md` |
| Instalador / desinstalador | `instalar.sh`, `instalar.cmd`, `scripts/setup.mjs`, `scripts/desinstalar.mjs` |
| Front (HTML/CSS/JS puro) | `public/` |

- Roda em `http://localhost:4321` e inicia junto com o sistema (configurado pelo instalador).
- Reiniciar o servidor:
  - Mac: `launchctl kickstart -k gui/$(id -u)/com.maestro.app`
  - Windows: encerrar o processo `node` do Maestro e abrir de novo pelo atalho `Maestro.vbs`
    da pasta Inicializar.
- API: `GET /api/pages`, `GET /api/pages/:id`, `GET /api/search?q=`, `GET /api/export`,
  `POST /api/pages/:id/blocks`, `PATCH /api/blocks/:id`.
- Testes do Maestro: `node maestro/eval.js` (so funciona na maquina com o gabarito; os
  arquivos de gabarito nao vao para o git porque sao feitos com notas pessoais).

## Regras inegociaveis

### 1. Nunca apagar este CLAUDE.md

- Nenhuma IA, script ou comando pode apagar, mover, renomear ou esvaziar este arquivo.
- Ele fica travado contra edicao (Mac: `chflags uchg`; Windows: `attrib +R`).
  **Nunca remova a trava** — so o dev faz isso, a mao.
- Precisa mudar alguma regra? Proponha o texto ao dev; ele destrava, edita e trava de novo.

### 2. Nunca salvar dados sensiveis

Nada disto entra em nota, bloco, `notas-md/`, log, commit ou mensagem:

- tokens, JWT, senhas, chaves de API, secrets, cookies de sessao, connection strings;
- conteudo de `.env` ou de arquivos de credenciais;
- CPF, CNPJ, telefone, e-mail, endereco ou qualquer dado pessoal de cliente/condominio;
- dumps de banco, payloads reais de producao.

Ao registrar algo de codigo, descreva **o que** foi feito e **onde** (arquivo, funcao), nunca
cole valores secretos. Se o texto a salvar contem algo assim, substitua por `[REMOVIDO]` e avise o dev.

### 3. Nunca apagar nem perder dados

- **Nada destrutivo sem pedir antes**: `rm`, `mv` sobre arquivo existente, `DROP`, `DELETE`,
  `git reset`, `git checkout --`, `git clean`, sobrescrever arquivo. Mostre o que vai fazer e espere um "sim".
- **Nunca mexa em `data/` direto** (banco, uploads, backups). Escreva nas notas **so pela API** do app.
- **Antes de qualquer escrita nas notas**, tire um backup na hora: `npm run backup`.
- **Nunca suba `data/` nem `notas-md/` para o git.** Sao as notas pessoais de cada dev.
- Este projeto ja perdeu um banco inteiro por um `rm` "de teste". Nao repita.

### 4. Nao editar `notas-md/`

E gerada pelo servidor a partir do SQLite e sobrescrita a cada alteracao. Edicao ali se perde
e nao volta para o app. Para ler as notas, ela e otima; para escrever, use a API.

### 5. Testes nunca no banco real

Use uma copia: `DB_PATH=/caminho/da/copia.db PORT=4399 MIRROR_DIR=/caminho/notas-teste node src/server.js`.
Atencao: o servidor de teste tambem grava backups em `data/backups/` — nao deixe ligado.
Para testar o instalador, use uma pasta de usuario falsa (`HOME=...`) e `--dry-run` antes.
Nunca crie nem apague paginas reais para testar.

### 6. O que o Claude escrever fica identificado

Toda entrada escrita por IA nas notas leva a marca `🤖 escrito pelo Claude` (com data), para o dev revisar.
Nunca reescreva nem apague texto que o dev escreveu sem ele pedir.

### 7. Mudancas pequenas e explicadas

- Nao refatore o que nao foi pedido. Nao instale dependencias (o projeto e zero-deps de proposito).
- Interpretacao de requisito vira proposta antes de virar codigo.
- Tudo precisa funcionar no Mac **e** no Windows: caminhos com `path.join`, nada de comando
  que so existe em um sistema sem alternativa para o outro.
- Mudou a busca ou os lembretes? Rode `node maestro/eval.js` e nao deixe nenhum caso piorar.
- Depois de mudar codigo do servidor, reinicie e confira que `http://localhost:4321` abre e as paginas carregam.