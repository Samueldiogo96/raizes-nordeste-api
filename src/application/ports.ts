import { Perfil } from '../domain/enums';

/**
 * Portas (interfaces) que a camada de aplicação usa e que a infraestrutura implementa.
 * Assim os casos de uso não dependem de um gateway de pagamento ou logger concreto
 * (Inversão de Dependência — o mock pode ser trocado por um provedor real sem mexer nas regras).
 */

/** Quem está executando a ação (extraído do JWT). */
export interface Ator {
  id: number;
  perfil: Perfil;
  unidadeId: number | null;
}

/** Contexto técnico da requisição, usado em auditoria/rastreabilidade. */
export interface Contexto {
  ator: Ator;
  requestId?: string;
  ip?: string;
}

// ------------------------------------------------------------------ Pagamento externo
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

/** Erro técnico de comunicação com o gateway (timeout, 5xx). Diferente de "recusado". */
export class GatewayIndisponivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayIndisponivelError';
  }
}

// ------------------------------------------------------------------ Auditoria
export interface RegistroAuditoria {
  acao: string;
  entidade: string;
  entidadeId?: string | number;
  detalhes?: Record<string, unknown>;
}

export interface AuditLogger {
  registrar(ctx: Contexto | null, registro: RegistroAuditoria, tx?: unknown): Promise<void>;
}
