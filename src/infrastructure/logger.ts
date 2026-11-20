import { config } from './config';

/**
 * Log em JSON, uma linha por evento.
 * Não registrar senha, token, e-mail completo nem dados de pagamento.
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
