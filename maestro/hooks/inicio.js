#!/usr/bin/env node
// Hook SessionStart: resumo da task da branch atual + tasks parecidas do passado.
import { lerEntrada, responder, branchAtual, desligado } from './comum.js';
import { briefing } from '../lembretes.js';

try {
  if (!desligado()) {
    const entrada = await lerEntrada();
    const branch = branchAtual(entrada.cwd ?? process.cwd());
    if (branch && branch !== 'HEAD') responder('SessionStart', briefing({ branch }));
  }
} catch {}
