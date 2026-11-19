import { config } from './config';

/**
 * Logger estruturado (JSON por linha). Em produção esses logs seriam enviados
 * para uma ferramenta de observabilidade (ex.: ELK, Datadog, CloudWatch).
 * Nunca registrar senha, token, e-mail completo ou dados de pagamento.
 */
type Nivel = 'info' | 'warn' | 'error';

function log(nivel: Nivel, msg: string, extra: Record<string, unknown> = {}) {
  if (config.isTest && nivel === 'info') return;
  const linha = JSON.stringify({ ts: new Date().toISOString(), nivel, msg, ...extra });
  if (nivel === 'error') console.error(linha);
  else console.log(linha);
}

export const logger = {
  info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra),
};
