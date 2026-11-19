import { timingSafeEqual } from 'node:crypto';
import { StatusPedido } from '../../domain/enums';
import { AppError, Erros } from '../../domain/errors';
import { paraCentavos, validarTransicao } from '../../domain/pedido';
import { config } from '../../infrastructure/config';
import { prisma, Tx } from '../../infrastructure/database/prisma';
import { logger } from '../../infrastructure/logger';
import { num } from '../common';
import { AuditLogger, Contexto, GatewayIndisponivelError, PaymentGateway, RespostaGateway } from '../ports';
import { FidelidadeService } from './fidelidade.service';
import { PedidoService } from './pedido.service';

export interface SolicitarPagamentoInput {
  pedidoId: number;
  tokenPagamento?: string;
}

/**
 * Integração DESACOPLADA com o provedor de pagamento.
 * O sistema NÃO processa cartão/PIX: apenas (1) solicita, (2) recebe aprovação/recusa,
 * (3) registra o resultado e (4) atualiza o status do pedido.
 *
 * Tolerância a falhas:
 *  - timeout por tentativa + retentativa com backoff (config PAYMENT_TIMEOUT_MS / PAYMENT_MAX_TENTATIVAS);
 *  - falha técnica (gateway fora) ≠ recusa: o pedido continua AGUARDANDO_PAGAMENTO e pode ser repago;
 *  - Idempotency-Key: o reenvio da mesma requisição não gera cobrança duplicada;
 *  - resultado assíncrono (PENDENTE) confirmado depois via webhook autenticado.
 */
export class PagamentoService {
  constructor(
    private readonly audit: AuditLogger,
    private readonly gateway: PaymentGateway,
    private readonly pedidos: PedidoService,
  ) {}

  async solicitar(ctx: Contexto, input: SolicitarPagamentoInput, idempotencyKey?: string) {
    // Idempotência: mesma chave → devolve o pagamento já registrado, sem chamar o gateway de novo.
    if (idempotencyKey) {
      const existente = await prisma.pagamento.findUnique({ where: { idempotencyKey }, include: { pedido: true } });
      if (existente) {
        this.pedidos.garantirVisibilidade(ctx, existente.pedido);
        return { http: 200, corpo: this.apresentar(existente, existente.pedido.status, 'Requisição repetida: retornando o resultado original.') };
      }
    }

    const pedido = await prisma.pedido.findUnique({ where: { id: input.pedidoId }, include: { pagamentos: true } });
    this.pedidos.garantirVisibilidade(ctx, pedido);
    const p = pedido!;
    const statusAtual = p.status as StatusPedido;

    if (!['AGUARDANDO_PAGAMENTO', 'PAGAMENTO_RECUSADO'].includes(statusAtual)) {
      throw Erros.conflito('PEDIDO_NAO_AGUARDA_PAGAMENTO', `O pedido está ${statusAtual} e não aceita pagamento.`);
    }
    if (p.pagamentos.some((pg) => pg.status === 'PENDENTE')) {
      throw Erros.conflito('PAGAMENTO_EM_PROCESSAMENTO', 'Já existe um pagamento pendente de confirmação para este pedido.');
    }

    const chave = idempotencyKey ?? `pedido-${p.id}-tentativa-${p.pagamentos.length + 1}`;
    const valorCentavos = paraCentavos(p.total);

    // Dinheiro no balcão: não passa pelo gateway; o atendente confirma o recebimento.
    if (p.formaPagamento === 'DINHEIRO') {
      if (!['ATENDENTE', 'GERENTE', 'ADMIN'].includes(ctx.ator.perfil)) throw Erros.semPermissao('Pagamento em dinheiro é confirmado pelo atendente.');
      const resposta: RespostaGateway = { status: 'APROVADO', transacaoId: `caixa_${p.id}_${Date.now()}`, codigoRetorno: 'CAIXA', processadoEm: new Date().toISOString() };
      return this.registrarResultado(ctx, p.id, statusAtual, 'CAIXA_LOCAL', p.formaPagamento, valorCentavos, chave, resposta, 1);
    }

    if (!input.tokenPagamento) {
      throw Erros.validacao('tokenPagamento é obrigatório para pagamentos eletrônicos.', [{ field: 'tokenPagamento', issue: 'Obrigatório' }]);
    }

    // Chamada ao gateway com timeout + retentativa (backoff linear).
    let tentativas = 0;
    let resposta: RespostaGateway | null = null;
    let ultimoErro = '';
    while (tentativas < config.paymentMaxTentativas && !resposta) {
      tentativas++;
      try {
        resposta = await this.comTimeout(
          this.gateway.solicitarPagamento({ pedidoId: p.id, valorCentavos, metodo: p.formaPagamento, tokenPagamento: input.tokenPagamento, idempotencyKey: chave }),
          config.paymentTimeoutMs,
        );
      } catch (e) {
        ultimoErro = (e as Error).message;
        logger.warn('gateway_pagamento_falhou', { pedidoId: p.id, tentativa: tentativas, erro: ultimoErro, requestId: ctx.requestId });
        if (tentativas < config.paymentMaxTentativas) await new Promise((r) => setTimeout(r, 100 * tentativas));
      }
    }

    if (!resposta) {
      // Falha técnica: registra a tentativa com status ERRO, pedido permanece aguardando pagamento.
      const pg = await prisma.pagamento.create({
        data: { pedidoId: p.id, provedor: this.gateway.nome, metodo: p.formaPagamento, valor: num(p.total), status: 'ERRO', tentativas, motivoRecusa: ultimoErro, idempotencyKey: chave },
      });
      await this.audit.registrar(ctx, { acao: 'PAGAMENTO_FALHA_GATEWAY', entidade: 'Pagamento', entidadeId: pg.id, detalhes: { pedidoId: p.id, tentativas, erro: ultimoErro } });
      throw new AppError(502, 'GATEWAY_PAGAMENTO_INDISPONIVEL', 'O serviço de pagamento está indisponível no momento. Nenhum valor foi cobrado; tente novamente.', [
        { field: 'pagamento', issue: `pagamentoId=${pg.id}; tentativas=${tentativas}; pedido continua ${statusAtual}` },
      ]);
    }

    return this.registrarResultado(ctx, p.id, statusAtual, this.gateway.nome, p.formaPagamento, valorCentavos, chave, resposta, tentativas);
  }

  /** Webhook do provedor (confirmação assíncrona, ex.: PIX). Autenticado por segredo compartilhado. */
  async processarWebhook(segredo: string | undefined, evento: { transacaoId: string; status: 'APROVADO' | 'RECUSADO'; motivo?: string }) {
    const esperado = Buffer.from(config.webhookSecret);
    const recebido = Buffer.from(segredo ?? '');
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
      throw Erros.naoAutenticado('Assinatura do webhook inválida.');
    }
    const pg = await prisma.pagamento.findUnique({ where: { transacaoExternaId: evento.transacaoId }, include: { pedido: true } });
    if (!pg) throw Erros.naoEncontrado('Pagamento');
    if (pg.status !== 'PENDENTE') {
      // Webhooks podem chegar repetidos: processamento idempotente.
      return { pagamentoId: pg.id, status: pg.status, processado: false, mensagem: 'Evento já processado anteriormente.' };
    }
    const statusPedido = pg.pedido.status as StatusPedido;
    await prisma.$transaction(async (tx) => {
      await tx.pagamento.update({ where: { id: pg.id }, data: { status: evento.status, motivoRecusa: evento.motivo ?? null, respostaGateway: JSON.stringify(evento) } });
      await this.aplicarNoPedido(tx, null, pg.pedidoId, statusPedido, evento.status, paraCentavos(pg.valor));
      await this.audit.registrar(null, { acao: evento.status === 'APROVADO' ? 'PAGAMENTO_APROVADO' : 'PAGAMENTO_RECUSADO', entidade: 'Pagamento', entidadeId: pg.id, detalhes: { pedidoId: pg.pedidoId, origem: 'webhook' } }, tx);
    });
    return { pagamentoId: pg.id, status: evento.status, processado: true };
  }

  async obter(ctx: Contexto, id: number) {
    const pg = await prisma.pagamento.findUnique({ where: { id }, include: { pedido: true } });
    if (!pg) throw Erros.naoEncontrado('Pagamento');
    this.pedidos.garantirVisibilidade(ctx, pg.pedido);
    return this.apresentar(pg, pg.pedido.status);
  }

  // ------------------------------------------------------------ internos
  private async registrarResultado(
    ctx: Contexto, pedidoId: number, statusAtual: StatusPedido, provedor: string, metodo: string,
    valorCentavos: number, chave: string, resposta: RespostaGateway, tentativas: number,
  ) {
    const resultado = await prisma.$transaction(async (tx) => {
      const pg = await tx.pagamento.create({
        data: {
          pedidoId, provedor, metodo, valor: valorCentavos / 100, status: resposta.status, tentativas,
          transacaoExternaId: resposta.transacaoId, motivoRecusa: resposta.motivo ?? null,
          respostaGateway: JSON.stringify(resposta), idempotencyKey: chave,
        },
      });
      let novoStatus: string = statusAtual;
      let pontos = 0;
      if (resposta.status !== 'PENDENTE') {
        const r = await this.aplicarNoPedido(tx, ctx.ator.id, pedidoId, statusAtual, resposta.status, valorCentavos);
        novoStatus = r.status;
        pontos = r.pontos;
      }
      await this.audit.registrar(ctx, {
        acao: `PAGAMENTO_${resposta.status}`,
        entidade: 'Pagamento',
        entidadeId: pg.id,
        detalhes: { pedidoId, provedor, codigoRetorno: resposta.codigoRetorno, valor: valorCentavos / 100, tentativas },
      }, tx);
      return { pg, novoStatus, pontos };
    });

    const mensagens = {
      APROVADO: 'Pagamento aprovado. Pedido enviado para a cozinha.',
      RECUSADO: `Pagamento recusado: ${resposta.motivo ?? 'motivo não informado'} Tente outro meio de pagamento.`,
      PENDENTE: 'Pagamento em processamento. O status será atualizado quando o provedor confirmar.',
    };
    const http = resposta.status === 'PENDENTE' ? 202 : 201;
    return { http, corpo: { ...this.apresentar(resultado.pg, resultado.novoStatus, mensagens[resposta.status]), pontosGanhos: resultado.pontos } };
  }

  private async aplicarNoPedido(tx: Tx, usuarioId: number | null, pedidoId: number, atual: StatusPedido, resultado: 'APROVADO' | 'RECUSADO', valorCentavos: number) {
    const novo: StatusPedido = resultado === 'APROVADO' ? 'PAGO' : 'PAGAMENTO_RECUSADO';
    validarTransicao(atual, novo);
    await this.pedidos.trocarStatus(tx, pedidoId, atual, novo, usuarioId, `Gateway: ${resultado}`);
    let pontos = 0;
    if (novo === 'PAGO') {
      const pedido = await tx.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
      pontos = await FidelidadeService.creditarPorPagamento(tx, pedido.clienteId, pedidoId, valorCentavos);
    }
    return { status: novo, pontos };
  }

  private comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new GatewayIndisponivelError(`Timeout de ${ms}ms ao chamar o gateway.`)), ms);
      promessa.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  private apresentar(pg: { id: number; pedidoId: number; provedor: string; metodo: string; valor: unknown; status: string; transacaoExternaId: string | null; motivoRecusa: string | null; tentativas: number; criadoEm: Date }, statusPedido: string, mensagem?: string) {
    return {
      pagamentoId: pg.id,
      pedidoId: pg.pedidoId,
      provedor: pg.provedor,
      metodo: pg.metodo,
      valor: num(pg.valor),
      status: pg.status,
      transacaoExternaId: pg.transacaoExternaId,
      motivoRecusa: pg.motivoRecusa,
      tentativas: pg.tentativas,
      statusPedido,
      mensagem,
      criadoEm: pg.criadoEm,
    };
  }
}
