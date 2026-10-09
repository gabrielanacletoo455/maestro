#!/usr/bin/env node
// Hook UserPromptSubmit: a cada mensagem, busca local por anotacoes ligadas ao pedido.
import { lerEntrada, responder, lerVistos, salvarVistos, desligado } from './comum.js';
import { lembretes } from '../lembretes.js';

try {
  if (!desligado()) {
    const entrada = await lerEntrada();
    const prompt = String(entrada.prompt ?? '').trim();
    if (prompt.length >= 12 && !prompt.startsWith('/')) {
      const sessao = entrada.session_id ?? 'sem-sessao';
      const vistos = lerVistos(sessao);
      const { texto, chaves } = lembretes(prompt, { vistos });
      if (texto) {
        for (const c of chaves) vistos.add(c);
        salvarVistos(sessao, vistos);
        responder('UserPromptSubmit', texto);
      }
    }
  }
} catch {}
