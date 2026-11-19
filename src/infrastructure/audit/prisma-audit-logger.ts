import { AuditLogger, Contexto, RegistroAuditoria } from '../../application/ports';
import { Db, prisma } from '../database/prisma';
import { logger } from '../logger';

/**
 * Grava a trilha de auditoria na tabela audit_logs.
 * Quando recebe uma transação (tx), o registro é gravado na MESMA transação da
 * operação de negócio: se a operação falhar, o log não fica "órfão", e vice-versa.
 */
export class PrismaAuditLogger implements AuditLogger {
  async registrar(ctx: Contexto | null, r: RegistroAuditoria, tx?: unknown): Promise<void> {
    const db = (tx as Db) ?? prisma;
    await db.auditLog.create({
      data: {
        acao: r.acao,
        entidade: r.entidade,
        entidadeId: r.entidadeId !== undefined ? String(r.entidadeId) : null,
        usuarioId: ctx?.ator.id ?? null,
        perfil: ctx?.ator.perfil ?? 'SISTEMA',
        detalhes: r.detalhes ? JSON.stringify(r.detalhes) : null,
        ip: ctx?.ip ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
    logger.info('auditoria', { acao: r.acao, entidade: r.entidade, entidadeId: r.entidadeId, requestId: ctx?.requestId });
  }
}
