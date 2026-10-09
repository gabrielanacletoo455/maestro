// Etapas de instalacao e desinstalacao do Maestro (Mac, Windows e Linux).
// Toda etapa e idempotente: rodar de novo nao duplica nada. Nenhuma etapa mexe nas notas (data/).

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync,
  symlinkSync, lstatSync, readlinkSync, chmodSync, readdirSync, unlinkSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.PORT ?? 4321);
const SO = platform();
const HOME = homedir();
const CLAUDE_DIR = join(HOME, '.claude');
const SETTINGS = join(CLAUDE_DIR, 'settings.json');
const SKILL_DIR = join(CLAUDE_DIR, 'skills', 'maestro');
const LABEL = 'com.maestro.app';
const MARCA_HOOK = 'maestro/hooks/';

const barra = (p) => p.split('\\').join('/');
const NODE = barra(process.execPath);
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');

export function criarContexto({ dryRun = false, semAutostart = false } = {}) {
  const log = [];
  return {
    dryRun,
    semAutostart,
    ok: (m) => console.log(`  ✅ ${m}`),
    info: (m) => console.log(`  ℹ️  ${m}`),
    plano: (m) => console.log(`  ${dryRun ? '🔎 faria:' : '→'} ${m}`),
    log,
  };
}

/* ------------------------------ app no login -------------------------------- */

async function servidorNoAr() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/pages`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function esperarServidor(segundos = 15) {
  for (let i = 0; i < segundos * 2; i++) {
    if (await servidorNoAr()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function agenteMacExistente() {
  const pasta = join(HOME, 'Library', 'LaunchAgents');
  if (!existsSync(pasta)) return null;
  for (const f of readdirSync(pasta)) {
    if (!f.endsWith('.plist')) continue;
    const texto = readFileSync(join(pasta, f), 'utf8');
    if (texto.includes(join(ROOT, 'src', 'server.js'))) return join(pasta, f);
  }
  return null;
}

const plistMac = () => join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const atalhoWindows = () =>
  join(process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Maestro.vbs');

export async function instalarAutostart(ctx) {
  const logs = join(ROOT, 'data', 'logs');
  if (ctx.semAutostart) return ctx.info('Iniciar com o sistema: pulado (--sem-autostart).');

  if (SO === 'darwin') {
    const existente = agenteMacExistente();
    if (existente && existente !== plistMac()) {
      ctx.ok(`App ja inicia com o Mac (${existente.split('/').pop()}).`);
    } else if (existente && (await servidorNoAr())) {
      ctx.ok('App ja inicia com o Mac.');
    } else {
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>--no-warnings</string>
    <string>${join(ROOT, 'src', 'server.js')}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${PORT}</string>
    <key>PATH</key><string>${dirname(process.execPath)}:${join(HOME, '.local', 'bin')}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logs, 'server.log')}</string>
  <key>StandardErrorPath</key><string>${join(logs, 'server.error.log')}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
      ctx.plano(`criar ${plistMac()} e iniciar o app`);
      if (!ctx.dryRun) {
        mkdirSync(logs, { recursive: true });
        mkdirSync(dirname(plistMac()), { recursive: true });
        writeFileSync(plistMac(), plist);
        const dominio = `gui/${process.getuid()}`;
        try { execFileSync('launchctl', ['bootout', `${dominio}/${LABEL}`], { stdio: 'ignore' }); } catch {}
        execFileSync('launchctl', ['bootstrap', dominio, plistMac()], { stdio: 'ignore' });
      }
    }
  } else if (SO === 'win32') {
    const vbs = atalhoWindows();
    const servidor = join(ROOT, 'src', 'server.js');
    const linha = `cmd /c ""${process.execPath}" --no-warnings "${servidor}" >> "${join(logs, 'server.log')}" 2>&1"`;
    const conteudo = [
      "' Inicia o Maestro escondido no login do Windows (criado pelo instalador).",
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = "${ROOT}"`,
      `sh.Run "${linha.replace(/"/g, '""')}", 0, False`,
      '',
    ].join('\r\n');
    ctx.plano(`criar ${vbs} e iniciar o app`);
    if (!ctx.dryRun) {
      mkdirSync(logs, { recursive: true });
      mkdirSync(dirname(vbs), { recursive: true });
      writeFileSync(vbs, conteudo);
      if (!(await servidorNoAr())) {
        spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
    }
  } else {
    return ctx.info('Linux: inicie o app com `npm start` (iniciar com o sistema ainda nao e automatico).');
  }

  if (ctx.dryRun) return;
  if (await esperarServidor()) ctx.ok(`App rodando em http://localhost:${PORT}`);
  else throw new Error(`o app nao respondeu em http://localhost:${PORT}. Veja os logs em ${logs}`);
}

export function removerAutostart(ctx) {
  if (SO === 'darwin') {
    const dominio = `gui/${process.getuid()}`;
    const alvo = existsSync(plistMac()) ? plistMac() : null;
    if (!alvo) return ctx.info('Nenhum agente do instalador para remover (agentes criados a mao ficam como estao).');
    ctx.plano(`parar o app e apagar ${alvo}`);
    if (ctx.dryRun) return;
    try { execFileSync('launchctl', ['bootout', `${dominio}/${LABEL}`], { stdio: 'ignore' }); } catch {}
    rmSync(alvo, { force: true });
    ctx.ok('App nao inicia mais com o Mac.');
  } else if (SO === 'win32') {
    const vbs = atalhoWindows();
    if (!existsSync(vbs)) return ctx.info('Nenhum atalho de inicializacao para remover.');
    ctx.plano(`apagar ${vbs} (o app atual para ao reiniciar o Windows)`);
    if (ctx.dryRun) return;
    rmSync(vbs, { force: true });
    ctx.ok('App nao inicia mais com o Windows.');
  }
}

/* ------------------------------ comando maestro ------------------------------ */

function pastaComandos() {
  if (SO === 'win32') return join(process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming'), 'npm');
  return join(HOME, '.local', 'bin');
}

const naPath = (pasta) =>
  (process.env.PATH ?? process.env.Path ?? '')
    .split(delimiter)
    .some((p) => p && barra(p).replace(/\/$/, '').toLowerCase() === barra(pasta).replace(/\/$/, '').toLowerCase());

export function instalarComando(ctx) {
  const pasta = pastaComandos();
  const cli = join(ROOT, 'maestro', 'cli.js');

  if (SO === 'win32') {
    // Mesmo esquema de "atalhos" que o npm usa: .cmd (cmd/PowerShell) + script sem extensao (Git Bash).
    ctx.plano(`criar maestro.cmd e maestro em ${pasta}`);
    if (!ctx.dryRun) {
      mkdirSync(pasta, { recursive: true });
      writeFileSync(join(pasta, 'maestro.cmd'), `@"${process.execPath}" --no-warnings "${cli}" %*\r\n`);
      writeFileSync(join(pasta, 'maestro'), `#!/bin/sh\nexec "${NODE}" --no-warnings "${barra(cli)}" "$@"\n`);
      if (!naPath(pasta)) {
        const atual = execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"], { encoding: 'utf8' }).trim();
        const novo = atual ? `${atual};${pasta}` : pasta;
        execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('Path', '${novo.replace(/'/g, "''")}', 'User')`]);
        ctx.info(`${pasta} adicionada ao PATH do usuario (vale para terminais novos).`);
      }
    }
  } else {
    const link = join(pasta, 'maestro');
    let atual = null;
    try { atual = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : 'arquivo'; } catch {}
    if (atual === cli) {
      ctx.ok(`Comando \`maestro\` ja aponta para este projeto (${link}).`);
    } else {
      if (atual === 'arquivo') throw new Error(`ja existe um arquivo ${link} que nao e do Maestro; renomeie e rode de novo`);
      ctx.plano(`criar o atalho ${link} -> ${cli}`);
      if (!ctx.dryRun) {
        mkdirSync(pasta, { recursive: true });
        if (atual) unlinkSync(link);
        chmodSync(cli, 0o755);
        symlinkSync(cli, link);
      }
    }
    if (!naPath(pasta)) {
      const rc = join(HOME, (process.env.SHELL ?? '').endsWith('bash') ? '.bashrc' : '.zshrc');
      const linha = 'export PATH="$HOME/.local/bin:$PATH" # maestro';
      const texto = existsSync(rc) ? readFileSync(rc, 'utf8') : '';
      if (!texto.includes('# maestro')) {
        ctx.plano(`adicionar ~/.local/bin ao PATH em ${rc}`);
        if (!ctx.dryRun) writeFileSync(rc, `${texto}${texto.endsWith('\n') || !texto ? '' : '\n'}${linha}\n`);
      }
    }
  }
  if (!ctx.dryRun) ctx.ok('Comando `maestro` disponivel (em terminais novos).');
}

export function removerComando(ctx) {
  const pasta = pastaComandos();
  const alvos = SO === 'win32' ? ['maestro.cmd', 'maestro'] : ['maestro'];
  for (const nome of alvos) {
    const arq = join(pasta, nome);
    let existe = false;
    try { lstatSync(arq); existe = true; } catch {}
    if (!existe) continue;
    if (SO !== 'win32' && lstatSync(arq).isSymbolicLink() && !readlinkSync(arq).includes(join('maestro', 'cli.js'))) {
      ctx.info(`${arq} nao e do Maestro; deixado como esta.`);
      continue;
    }
    ctx.plano(`apagar ${arq}`);
    if (!ctx.dryRun) rmSync(arq, { force: true });
  }
  if (!ctx.dryRun) ctx.ok('Comando `maestro` removido.');
}

/* ----------------------------------- skill ---------------------------------- */

export function instalarSkill(ctx) {
  const origem = join(ROOT, 'maestro', 'skill', 'SKILL.md');
  const destino = join(SKILL_DIR, 'SKILL.md');
  const novo = readFileSync(origem, 'utf8');
  if (existsSync(destino) && readFileSync(destino, 'utf8') === novo) return ctx.ok('Skill do Maestro ja instalada e atualizada.');
  ctx.plano(`instalar a skill em ${destino}`);
  if (ctx.dryRun) return;
  mkdirSync(SKILL_DIR, { recursive: true });
  if (existsSync(destino)) copyFileSync(destino, `${destino}.antes-${stamp()}`);
  writeFileSync(destino, novo);
  ctx.ok('Skill do Maestro instalada no Claude Code.');
}

export function removerSkill(ctx) {
  if (!existsSync(SKILL_DIR)) return ctx.info('Skill nao estava instalada.');
  ctx.plano(`apagar ${SKILL_DIR}`);
  if (ctx.dryRun) return;
  rmSync(SKILL_DIR, { recursive: true, force: true });
  ctx.ok('Skill removida.');
}

/* ----------------------------------- hooks ---------------------------------- */

function lerSettings() {
  if (!existsSync(SETTINGS)) return { dados: {}, existia: false };
  const texto = readFileSync(SETTINGS, 'utf8');
  try {
    return { dados: texto.trim() ? JSON.parse(texto) : {}, existia: true };
  } catch (err) {
    throw new Error(
      `o arquivo ${SETTINGS} ja esta com erro de formatacao (${err.message}). ` +
        'Nada foi alterado. Corrija o arquivo (ou peca ajuda) e rode o instalador de novo.'
    );
  }
}

function semHooksDoMaestro(lista = []) {
  return lista
    .map((grupo) => ({ ...grupo, hooks: (grupo.hooks ?? []).filter((h) => !barra(h.command ?? '').includes(MARCA_HOOK)) }))
    .filter((grupo) => grupo.hooks.length);
}

function gravarSettings(ctx, dados, existia, descricao) {
  ctx.plano(descricao);
  if (ctx.dryRun) return;
  mkdirSync(CLAUDE_DIR, { recursive: true });
  if (existia) copyFileSync(SETTINGS, `${SETTINGS}.antes-do-maestro-${stamp()}`);
  const texto = `${JSON.stringify(dados, null, 2)}\n`;
  JSON.parse(texto);
  writeFileSync(SETTINGS, texto);
}

export function instalarHooks(ctx) {
  const { dados, existia } = lerSettings();
  const cmd = (arquivo) => `"${NODE}" "${barra(join(ROOT, 'maestro', 'hooks', arquivo))}"`;
  const novo = structuredClone(dados);
  novo.hooks ??= {};
  novo.hooks.SessionStart = [...semHooksDoMaestro(novo.hooks.SessionStart), { hooks: [{ type: 'command', command: cmd('inicio.js'), timeout: 10 }] }];
  novo.hooks.UserPromptSubmit = [...semHooksDoMaestro(novo.hooks.UserPromptSubmit), { hooks: [{ type: 'command', command: cmd('mensagem.js'), timeout: 5 }] }];

  if (JSON.stringify(novo) === JSON.stringify(dados)) return ctx.ok('Hooks do Maestro ja configurados.');
  gravarSettings(ctx, novo, existia, `adicionar os hooks do Maestro em ${SETTINGS} (com copia de seguranca antes)`);
  if (!ctx.dryRun) ctx.ok('Hooks configurados: lembretes no inicio da conversa e a cada mensagem.');
}

export function removerHooks(ctx) {
  if (!existsSync(SETTINGS)) return ctx.info('Sem settings.json, nada a remover.');
  const { dados } = lerSettings();
  const novo = structuredClone(dados);
  for (const evento of ['SessionStart', 'UserPromptSubmit']) {
    if (!novo.hooks?.[evento]) continue;
    novo.hooks[evento] = semHooksDoMaestro(novo.hooks[evento]);
    if (!novo.hooks[evento].length) delete novo.hooks[evento];
  }
  if (novo.hooks && !Object.keys(novo.hooks).length) delete novo.hooks;
  if (JSON.stringify(novo) === JSON.stringify(dados)) return ctx.info('Nenhum hook do Maestro no settings.json.');
  gravarSettings(ctx, novo, true, `tirar os hooks do Maestro de ${SETTINGS} (com copia de seguranca antes)`);
  if (!ctx.dryRun) ctx.ok('Hooks removidos (o resto do settings.json ficou igual).');
}

/* -------------------------------- verificacao ------------------------------- */

export function verificar(ctx) {
  if (ctx.dryRun) return;
  const saida = execFileSync(process.execPath, ['--no-warnings', join(ROOT, 'maestro', 'cli.js'), 'teste de instalacao'], { encoding: 'utf8' });
  if (!saida.includes('Maestro')) throw new Error('o comando maestro nao respondeu como esperado');
  ctx.ok('Busca do Maestro respondendo.');
}
