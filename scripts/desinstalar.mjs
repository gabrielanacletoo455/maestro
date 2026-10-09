#!/usr/bin/env node
// Desfaz a instalacao do Maestro: hooks, skill, comando e inicio automatico.
// NUNCA apaga as notas: data/ (banco, backups, imagens) fica intacta.
//
// Uso: npm run desinstalar [-- --dry-run]
import * as lib from './lib-instalacao.mjs';

const dryRun = process.argv.includes('--dry-run');
const ctx = lib.criarContexto({ dryRun });
console.log(`\n🎼 Desinstalando o Maestro${dryRun ? ' (simulacao, nada sera alterado)' : ''}\n`);

for (const [nome, etapa] of [
  ['tirar os hooks do Claude Code', lib.removerHooks],
  ['remover a skill', lib.removerSkill],
  ['remover o comando maestro', lib.removerComando],
  ['parar de iniciar com o sistema', lib.removerAutostart],
]) {
  try {
    await etapa(ctx);
  } catch (err) {
    console.error(`  ❌ Falhou ao ${nome}: ${err.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n  Suas notas continuam em ${lib.ROOT}/data — apague a pasta so se quiser perder tudo.\n`);
