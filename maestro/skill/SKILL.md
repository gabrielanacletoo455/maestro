---
name: maestro
allowed-tools: Bash(maestro:*), Bash(rtk maestro:*)
description: Memoria local do dev (app Maestro). Use SEMPRE que o usuario perguntar sobre trabalho passado ou anotacoes dele - tasks, sprints, bugs/chamados, o que fez em um dia, links de PR ou ClickUp, decisoes, conversas com colegas, arquivos/componentes de uma task, "lembra quando...", "onde anotei...". Consulta rodando o comando `maestro "pergunta"`, que busca localmente (sem IA, 0 tokens) e devolve so os trechos relevantes.
---

# Maestro — memoria local

O Maestro e um motor de busca local nas anotacoes do dev. Ele **so le** as notas; nunca escreve.

## Quando usar

Antes de responder qualquer pergunta sobre o trabalho passado do usuario: tasks, sprints, bugs,
datas ("ontem", "semana passada", "em setembro"), links de PR/ClickUp, conversas, decisoes, arquivos criados.
Nao use para perguntas sobre o codigo atual — para isso leia o repositorio.

## Como usar

```bash
maestro "pergunta"
```

1. **Passe a pergunta do usuario quase como ele escreveu.** O Maestro entende sozinho:
   sprint passada/atual/"sprint 15 do 09", task, bug/chamado, datas em portugues, "mais antiga",
   "sem link do PR", "link do clickup", "quais arquivos", erros de digitacao e falta de acento.
2. **Se vier "Nada encontrado" ou resultado fora do assunto**, reformule com palavras que provavelmente
   estao na nota: nome da task, sinonimos, termos tecnicos, nome da pessoa
   (ex.: "aquele problema chato do login" → `maestro "login token expirado redirect"`).
   Tente no maximo 3 variacoes.
3. **Responda com base so no que o Maestro devolveu.** Cite o titulo da pagina e o link
   `http://localhost:4321/#...` que veio no resultado. Se a nota nao responde, diga isso — nunca invente.
4. Precisa de mais detalhe de uma pagina? Rode de novo com o titulo dela + o assunto
   (ex.: `maestro "Autotriagem - Ajustes na configuracao permissoes"`).

## Lembretes automaticos (sem o usuario pedir)

Hooks do Maestro colocam blocos `📒 Maestro` na conversa: no inicio (resumo da task da branch atual e
tasks parecidas do passado) e a cada mensagem (anotacoes ligadas ao pedido). Ao ver um desses blocos:

- **Se for relevante para o que o usuario pediu, avise por conta propria**, citando data e fonte:
  "no dia 08/10 o Vinicius disse...", "na doc do Kaio de 02/10 o campo e X", "voce ja fez algo parecido
  na task Y (link)".
- **Se o pedido ou o codigo contradiz o que esta anotado, avise antes de seguir.** Mostre as duas versoes
  com data; nao decida sozinho qual esta certa.
- Antes de decidir contrato de API, regra de negocio ou permissao, rode `maestro` com o assunto para conferir.
- Se o bloco nao tiver relacao com o pedido, ignore em silencio. Nao comente que o bloco existe.

## Regras

- Nunca edite `notas-md/` nem o banco do app. O Maestro e so leitura.
- Nao repita no chat dados sensiveis que aparecerem nos resultados (senhas, tokens, CPF/CNPJ).
- Se o comando `maestro` nao existir, avise o usuario: falta rodar a instalacao do projeto Maestro.
