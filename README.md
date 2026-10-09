# Maestro

Workspace de anotacoes rodando 100% local. **Zero dependencias** — nenhum `node_modules`.
Backend: `node:http` + `node:sqlite`. Frontend: JS modules puro.

## Instalar (Mac ou Windows)

Pre-requisito: nenhum. Se o Node 22.13+ nao estiver instalado, o instalador instala a versao LTS.

```bash
git clone <repositorio> maestro
cd maestro
./instalar.sh          # Mac
```

No Windows: dois cliques em `instalar.cmd` (ou rode `instalar.cmd` no terminal).

O instalador:

1. verifica o Node (e instala se faltar) e testa o SQLite embutido;
2. faz o app iniciar junto com o sistema (http://localhost:4321);
3. registra o comando `maestro` no terminal;
4. instala a skill do Maestro no Claude Code;
5. adiciona os hooks de lembretes no `~/.claude/settings.json` (com copia de seguranca antes;
   se o arquivo ja estiver com erro, nao mexe e explica o que corrigir).

Depois, abra uma **conversa nova** no Claude Code. Para simular sem mudar nada: `./instalar.sh --dry-run`.
Se algo falhar, o instalador mostra em qual passo parou e o erro.

Para desinstalar (as notas em `data/` nunca sao apagadas):

```bash
npm run desinstalar
```

## Rodar

```bash
cd anotacoes-gab
npm start          # http://localhost:4321
```

`npm run dev` roda com `--watch`. `npm run backup` tira um snapshot na hora.

O banco fica em `data/anotacoes.db` (SQLite em WAL) e as imagens em `data/uploads/`.
Da para abrir o banco com qualquer cliente SQLite ou com `sqlite3 data/anotacoes.db`.

## Backups

O servidor tira um snapshot do banco ao subir e a cada 15 minutos (se algo mudou), em
`data/backups/`: guarda todos das ultimas 48h e, antes disso, o ultimo de cada dia, para sempre. Usa `VACUUM INTO`, que copia de
forma consistente mesmo com o servidor escrevendo (um `cp` do arquivo com WAL
ativo pode sair corrompido).

```bash
npm run backup                     # snapshot manual agora
curl localhost:4321/api/backups    # listar snapshots
```

Para restaurar: pare o servidor, copie o snapshot por cima de
`data/anotacoes.db` e apague os arquivos `-wal`/`-shm` que sobraram.

## Iniciar junto com o Mac

```bash
npm run autostart:install
```

Instala um LaunchAgent do usuario (`~/Library/LaunchAgents/com.anotacoesgab.server.plist`)
com `RunAtLoad` e `KeepAlive`: sobe no login e reinicia sozinho se cair.
Logs em `data/logs/server.log` e `data/logs/server.error.log`.

```bash
npm run autostart:status      # ver se esta rodando e qual o PID
npm run autostart:uninstall   # remover do login
```

Para mudar a porta: `PORT=5000 npm run autostart:install`.

## Funcionalidades

**Paginas**
- Arvore infinita de paginas aninhadas (arraste uma pagina para dentro de outra)
- Titulo e icone editaveis, favoritos, breadcrumb
- Lixeira com soft delete recursivo, restaurar e excluir permanente
- Busca full-text (FTS5) sobre titulos e conteudo — `Cmd+K`
- Deep link por hash (`#p_abc123`) e ultima pagina lembrada

**Editar com seguranca**
- `Cmd/Ctrl+S` salva na hora tudo que estava no debounce (o autosave ja faz isso
  sozinho, mas o atalho confirma)
- `Cmd/Ctrl+Z` desfaz e `Cmd/Ctrl+Shift+Z` (ou `Ctrl+Y`) refaz — cobre texto,
  criar/apagar bloco, trocar tipo, mover, checkbox, icone e titulo
- Digitacao vira um unico ponto de undo por rajada, nao um por tecla
- Todos os atalhos funcionam em Mac e Windows/Linux; os rotulos na tela mudam
  entre `⌘` e `Ctrl+` conforme o sistema

**Links**
- URL colada ou digitada seguida de espaco vira link sozinha
- `[nome](endereco)` vira um link com o nome que voce escolheu
- Com texto selecionado: `Cmd/Ctrl+K` (ou o botao 🔗 da barra) abre um popover
  para definir texto e URL, editar um link existente ou remove-lo
- Colar uma URL por cima de um texto selecionado transforma a selecao em link
- Clicar abre em uma aba nova; `Alt+clique` posiciona o cursor para editar
- Enderecos sao normalizados (`ok.com` -> `https://ok.com`, e-mail -> `mailto:`)
  e esquemas perigosos como `javascript:` e `data:` sao recusados

**Editor de blocos**
- Tipos: texto, titulo 1/2/3, lista, lista numerada, tarefa, citacao, destaque,
  codigo, imagem, divisor, sub-pagina
- Menu `/` com busca incremental e navegacao por teclado
- Atalhos markdown: `# `, `## `, `### `, `- `, `1. `, `[] `, `> `, ` ``` `, `---`
- Formatacao inline: `Cmd+B`, `Cmd+I`, `Cmd+U`, `Cmd+E` (codigo) e toolbar flutuante na selecao
- Enter divide o bloco no cursor; Backspace no inicio mescla com o anterior
- Enter em item de lista vazio sai da lista
- Setas navegam entre blocos; arrastar pela alca `⠿` reordena
- Autosave com debounce de 400ms e flush no blur

**Imagens**
- Bloco de imagem pelo menu `/`, colando com `Cmd+V` ou arrastando o arquivo na pagina
- Os arquivos ficam em `data/uploads/` — nada sai da sua maquina
- Legenda por imagem (entra no indice de busca)
- Aceita png, jpg, gif, webp, svg, avif e bmp ate 15MB; o nome no disco e
  normalizado + sufixo aleatorio, entao upload nunca sobrescreve nada

**Configuracoes** (`Cmd/Ctrl+,`, no rodape da sidebar ou clicando no nome do workspace)
- Tema: Claro, Escuro ou Automatico (segue o sistema e troca ao vivo)
- Export do workspace inteiro em um unico JSON — paginas em arvore com os blocos
  dentro, opcionalmente com as imagens embutidas em base64 e a lixeira incluida

**Interface**
- Sidebar recolhivel (`Cmd+\`), estado de expansao persistido
- `Cmd+Shift+N` cria pagina nova, `Cmd+,` abre configuracoes
- Toast com "Desfazer" ao excluir

## Estrutura

```
src/db.js       schema, PRAGMAs, indice FTS, seed
src/repo.js     operacoes de pagina e bloco + export do workspace
src/uploads.js  gravacao/leitura das imagens em data/uploads
src/backup.js   snapshots automaticos do banco em data/backups
src/server.js   roteador HTTP + estatico + /uploads + fallback SPA
scripts/autostart.sh   instala/remove o LaunchAgent do login
public/js/
  app.js         boot, rotas, atalhos globais
  editor.js      editor de blocos (caret, split, merge, drag, imagens)
  blockTypes.js  registro de tipos: render + menu "/" + markdown
  theme.js       preferencia de tema (claro/escuro/automatico)
  history.js     pilha de undo/redo por snapshot
  links.js       autolink, markdown link, href seguro
  platform.js    rotulos de atalho por sistema (Mac vs Windows)
  sidebar.js     arvore de paginas
  menus.js       menu "/", toolbar de formatacao, emoji picker
  overlays.js    busca, lixeira, configuracoes, toast
  api.js         cliente HTTP
```

## Modelo de dados

`pages(id, parent_id, title, icon, cover, position, favorite, deleted_at, ...)`
auto-referencial — a arvore inteira sai em uma query e e montada em memoria.

`blocks(id, page_id, parent_id, type, content, props, position, ...)` — `content`
guarda HTML inline (negrito, italico, `code`), `props` guarda JSON por tipo
(`checked` da tarefa, `pageId` da sub-pagina, `emoji` do destaque).

`search_fts` e uma tabela FTS5 reconstruida por pagina a cada escrita.

Imagens nao entram no banco: o arquivo vai para `data/uploads/` e o bloco guarda
so a URL em `props`. Mantem o `.db` pequeno e o backup e um `cp -r data/`.

## API

| Metodo | Rota | O que faz |
|---|---|---|
| GET | `/api/pages` | arvore + favoritos |
| GET/POST/PATCH/DELETE | `/api/pages[/:id]` | CRUD de pagina (DELETE = lixeira) |
| POST | `/api/pages/:id/restore` | tira da lixeira |
| DELETE | `/api/pages/:id/purge` | apaga de vez |
| POST | `/api/pages/:id/blocks` | cria bloco |
| PUT | `/api/pages/:id/blocks/order` | reordena |
| PATCH/DELETE | `/api/blocks/:id` | edita / remove bloco |
| GET | `/api/search?q=` | busca FTS5 |
| POST | `/api/uploads` | upload de imagem (corpo binario + `X-Filename`) |
| PUT | `/api/pages/:id/blocks` | troca todos os blocos (usado pelo undo) |
| GET | `/api/export?assets=1&trash=1` | JSON do workspace inteiro |
| GET/POST | `/api/backups` | lista / cria snapshot do banco |
# maestro
