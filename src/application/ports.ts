import { Perfil } from '../domain/enums';

/**
 * Interfaces usadas pelos casos de uso e implementadas pela infraestrutura.
 * Assim o mock de pagamento pode ser trocado sem mexer nas regras.
 */

/** Usuário que executa a ação (vem do JWT). */
export interface Ator {
  id: number;
  perfil: Perfil;
  unidadeId: number | null;
}

/** Dados da requisição usados na auditoria. */
export interface Contexto {
  ator: Ator;
  requestId?: string;
  ip?: string;
}

export interface SolicitacaoPagamento {
  pedidoId: number;
  valorCentavos: number;
  metodo: string;
  tokenPagamento: string; // token do cartão/PIX gerado no front pelo provedor (nunca o nº do cartão)
  idempotencyKey: string;
}

export interface RespostaGateway {
  status: 'APROVADO' | 'RECUSADO' | 'PENDENTE';
  transacaoId: string;
  motivo?: string;
  codigoRetorno: string;
  processadoEm: string;
}

export interface PaymentGateway {
  readonly nome: string;
  solicitarPagamento(req: SolicitacaoPagamento): Promise<RespostaGateway>;
  estornar(transacaoId: string, valorCentavos: number): Promise<{ estornado: boolean }>;
}

/** Falha técnica no gateway (timeout, 5xx), diferente de pagamento recusado. */
export class GatewayIndisponivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayIndisponivelError';
  }
}

export interface RegistroAuditoria {
  acao: string;
  entidade: string;
  entidadeId?: string | number;
  detalhes?: Record<string, unknown>;
}

export interface AuditLogger {
  registrar(ctx: Contexto | null, registro: RegistroAuditoria, tx?: unknown): Promise<void>;
}
