/**
 * Logger centralizado main process. Usa pino (já em deps).
 * Sempre estruturado: { event, ...payload }.
 * NÃO usar console.log direto (regra hard).
 */

import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  base: { app: 'flowtype' },
});

export type Logger = typeof logger;
