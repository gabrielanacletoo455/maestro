#!/usr/bin/env node
// Instalacao do Maestro na maquina do dev. Roda depois que o instalar.sh / instalar.ps1
// garantiu o Node. Cada etapa e segura para rodar de novo (nao duplica nada).
//
// Uso: node scripts/setup.mjs [--dry-run]

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const MIN = [22, 13];
const dryRun = process.argv.includes('--dry-run');
const ok = (msg) => console.log(`  ✅ ${msg}`);

// Erro inesperado em qualquer etapa: mostra a mensagem completa e como pedir ajuda.
process.on('uncaughtException', (err) => {
  console.error(`\n  ❌ Erro inesperado na instalacao: ${err.message}`);
  console.error(err.stack?.split('\n').slice(1, 4).join('\n'));
  console.error('\n     Tire um print desta tela e mande para quem te passou o Maestro.\n');
  process.exit(1);
});
const falha = (msg, dica) => {
  console.error(`  ❌ ${msg}`);
  if (dica) console.error(`     ${dica}`);
  process.exit(1);
};

console.log(`\n🎼 Instalando o Maestro${dryRun ? ' (simulacao, nada sera alterado)' : ''}\n`);

// 1. Versao do Node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN[0] || (major === MIN[0] && minor < MIN[1])) {
  falha(
    `Node ${process.versions.node} e antigo demais (precisa ${MIN.join('.')} ou mais novo).`,
    platform() === 'win32' ? 'Rode o instalar.cmd de novo: ele atualiza o Node.' : 'Rode ./instalar.sh de novo: ele atualiza o Node.'
  );
}
ok(`Node ${process.versions.node}`);

// 2. SQLite embutido no Node: grava, le e apaga um banco de teste numa pasta temporaria
try {
  process.removeAllListeners('warning');
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'maestro-setup-'));
  try {
    const db = new DatabaseSync(join(dir, 'teste.db'));
    db.exec('CREATE TABLE t (v TEXT); CREATE VIRTUAL TABLE f USING fts5(v);');
    db.prepare('INSERT INTO t VALUES (?)').run('ok');
    const { v } = db.prepare('SELECT v FROM t').get();
    db.close();
    if (v !== 'ok') throw new Error('leitura devolveu valor errado');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  ok('SQLite embutido no Node funcionando (com busca full-text)');
} catch (err) {
  falha(`O SQLite do Node nao funcionou: ${err.message}`, 'Atualize o Node para a versao LTS mais recente.');
}

// 3 a 7. App, comando, skill, hooks e verificacao final
const lib = await import('./lib-instalacao.mjs');
const ctx = lib.criarContexto({ dryRun, semAutostart: process.argv.includes('--sem-autostart') });
const etapas = [
  ['iniciar o app junto com o sistema', lib.instalarAutostart],
  ['registrar o comando maestro', lib.instalarComando],
  ['instalar a skill no Claude Code', lib.instalarSkill],
  ['configurar os hooks no Claude Code', lib.instalarHooks],
  ['testar a busca', lib.verificar],
];
for (const [nome, etapa] of etapas) {
  try {
    await etapa(ctx);
  } catch (err) {
    falha(`Falhou ao ${nome}: ${err.message}`, 'Tire um print desta tela e mande para quem te passou o Maestro.');
  }
}

console.log(
  dryRun
    ? '\n  Simulacao concluida. Rode sem --dry-run para instalar de verdade.\n'
    : [
        '',
        '  🎉 Maestro instalado!',
        `     App:  http://localhost:${lib.PORT}`,
        '     Abra uma CONVERSA NOVA no Claude Code para ele comecar a usar a memoria.',
        '',
        '     Escrita automatica (o Claude anota sozinho o que voce faz):',
        '       rode `claude` no terminal e faca /login UMA vez — o resumo usa o Haiku do seu plano.',
        '     Importar suas conversas antigas para o Maestro (pergunta antes, voce aprova):',
        '       maestro importar',
        '     Para desinstalar: npm run desinstalar  (suas notas em data/ nunca sao apagadas)',
        '',
      ].join('\n')
);
