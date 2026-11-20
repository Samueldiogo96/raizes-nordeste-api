import { randomUUID } from 'node:crypto';
import {
  GatewayIndisponivelError,
  PaymentGateway,
  RespostaGateway,
  SolicitacaoPagamento,
} from '../../application/ports';

/**
 * Gateway de pagamento simulado.
 * O resultado depende do tokenPagamento:
 *
 *  tok_aprovado        → APROVADO (código 00)
 *  tok_recusado        → RECUSADO por saldo insuficiente (código 51)
 *  tok_cartao_bloqueado→ RECUSADO cartão bloqueado (código 62)
 *  tok_pendente        → PENDENTE (confirmado depois pelo webhook)
 *  tok_falha_gateway   → lança GatewayIndisponivelError (simula timeout/5xx)
 *  qualquer outro      → APROVADO
 *
 * A mesma idempotencyKey devolve a mesma resposta.
 */
export class MockPaymentGateway implements PaymentGateway {
  readonly nome = 'MOCK';
  private respostas = new Map<string, RespostaGateway>();

  async solicitarPagamento(req: SolicitacaoPagamento): Promise<RespostaGateway> {
    const anterior = this.respostas.get(req.idempotencyKey);
    if (anterior) return anterior;

    await new Promise((r) => setTimeout(r, 30)); // latência simulada de rede

    if (req.tokenPagamento === 'tok_falha_gateway') {
      throw new GatewayIndisponivelError('Gateway de pagamento não respondeu (timeout simulado).');
    }

    const base = { transacaoId: `mock_${randomUUID()}`, processadoEm: new Date().toISOString() };
    let resposta: RespostaGateway;
    switch (req.tokenPagamento) {
      case 'tok_recusado':
        resposta = { ...base, status: 'RECUSADO', codigoRetorno: '51', motivo: 'Saldo insuficiente.' };
        break;
      case 'tok_cartao_bloqueado':
        resposta = { ...base, status: 'RECUSADO', codigoRetorno: '62', motivo: 'Cartão bloqueado pelo emissor.' };
        break;
      case 'tok_pendente':
        resposta = { ...base, status: 'PENDENTE', codigoRetorno: 'P1', motivo: 'Aguardando confirmação do pagador.' };
        break;
      default:
        resposta = { ...base, status: 'APROVADO', codigoRetorno: '00' };
    }
    this.respostas.set(req.idempotencyKey, resposta);
    return resposta;
  }

  async estornar(_transacaoId: string, _valorCentavos: number) {
    await new Promise((r) => setTimeout(r, 10));
    return { estornado: true };
  }
}
