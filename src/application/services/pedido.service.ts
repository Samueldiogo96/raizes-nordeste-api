import { Prisma } from '@prisma/client';
import { motivoIndisponibilidade } from '../../domain/cardapio';
import { CanalPedido, FormaPagamento, StatusPedido } from '../../domain/enums';
import { AppError, ErroDetalhe, Erros } from '../../domain/errors';
import { calcularDescontoResgateCentavos } from '../../domain/fidelidade';
import {
  calcularSubtotalCentavos,
  cancelamentoDevolveEstoque,
  cancelamentoExigeEstorno,
  consolidarItens,
  LinhaPedido,
  paraCentavos,
  paraReais,
  validarCanalParaPerfil,
  validarCancelamento,
  validarMudancaOperacional,
} from '../../domain/pedido';
import { calcularDescontoPromocaoCentavos } from '../../domain/promocao';
import { config } from '../../infrastructure/config';
import { prisma, Tx } from '../../infrastructure/database/prisma';
import { metaPaginacao, num, paginar, Paginacao } from '../common';
import { AuditLogger, Contexto, PaymentGateway } from '../ports';
import { EstoqueService } from './estoque.service';
import { FidelidadeService } from './fidelidade.service';
import { temConsentimento } from './usuario.service';

export interface CriarPedidoInput {
  unidadeId: number;
  canalPedido: CanalPedido;
  clienteId?: number;
  itens: { produtoId: number; quantidade: number }[];
  formaPagamento: FormaPagamento;
  codigoPromocao?: string;
  pontosResgatar?: number;
  observacao?: string;
}

export interface FiltroPedidos extends Partial<Paginacao> {
  canalPedido?: string;
  status?: string;
  unidadeId?: number;
  dataInicio?: string;
  dataFim?: string;
}

const includeCompleto = {
  itens: { include: { produto: { select: { nome: true } } } },
  pagamentos: { orderBy: { id: 'desc' as const } },
  historico: { orderBy: { id: 'asc' as const } },
  unidade: { select: { id: true, nome: true } },
};
type PedidoCompleto = Prisma.PedidoGetPayload<{ include: typeof includeCompleto }>;

/** Monta a resposta da API, sem dados pessoais do cliente. */
export function apresentarPedido(p: PedidoCompleto) {
  return {
    pedidoId: p.id,
    unidade: p.unidade,
    canalPedido: p.canalPedido,
    status: p.status,
    clienteId: p.clienteId,
    formaPagamento: p.formaPagamento,
    itens: p.itens.map((i) => ({
      produtoId: i.produtoId,
      nome: i.produto.nome,
      quantidade: i.quantidade,
      precoUnitario: num(i.precoUnitario),
      subtotal: num(i.subtotal),
    })),
    subtotal: num(p.subtotal),
    desconto: num(p.desconto),
    total: num(p.total),
    pontosResgatados: p.pontosResgatados,
    observacao: p.observacao,
    motivoCancelamento: p.motivoCancelamento,
    pagamentos: p.pagamentos.map((pg) => ({
      pagamentoId: pg.id,
      status: pg.status,
      valor: num(pg.valor),
      transacaoExternaId: pg.transacaoExternaId,
      motivoRecusa: pg.motivoRecusa,
      criadoEm: pg.criadoEm,
    })),
    historicoStatus: p.historico.map((h) => ({ de: h.statusAnterior, para: h.statusNovo, em: h.criadoEm, usuarioId: h.usuarioId })),
    createdAt: p.criadoEm,
    updatedAt: p.atualizadoEm,
  };
}

export class PedidoService {
  constructor(
    private readonly audit: AuditLogger,
    private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Cria o pedido. Valida canal, unidade, itens, promoção e pontos, calcula o total
   * e grava tudo numa transação: se algo falhar, nada é salvo.
   */
  async criar(ctx: Contexto, input: CriarPedidoInput, idempotencyKey?: string) {
    const { ator } = ctx;

    // 0) Idempotência: o app pode reenviar a mesma requisição.
    if (idempotencyKey) {
      const existente = await prisma.pedido.findUnique({ where: { idempotencyKey }, include: includeCompleto });
      if (existente) {
        const mesmoAutor = ator.perfil === 'CLIENTE' ? existente.clienteId === ator.id : existente.operadorId === ator.id;
        if (!mesmoAutor) {
          throw Erros.conflito('IDEMPOTENCY_KEY_EM_USO', 'Esta Idempotency-Key já foi usada por outra requisição.');
        }
        return { pedido: apresentarPedido(existente), reaproveitado: true };
      }
    }

    // 1) Canal compatível com o perfil.
    validarCanalParaPerfil(input.canalPedido, ator.perfil);
    if (input.formaPagamento === 'DINHEIRO' && input.canalPedido !== 'BALCAO') {
      throw Erros.validacao('Pagamento em dinheiro só é aceito no balcão.', [{ field: 'formaPagamento', issue: 'DINHEIRO exige canalPedido=BALCAO' }]);
    }

    // 2) Cliente.
    let clienteId: number | null = null;
    if (ator.perfil === 'CLIENTE') {
      if (input.clienteId && input.clienteId !== ator.id) throw Erros.semPermissao('Um cliente não pode criar pedidos em nome de outro.');
      clienteId = ator.id;
    } else if (input.clienteId) {
      const cli = await prisma.usuario.findUnique({ where: { id: input.clienteId } });
      if (!cli || cli.perfil !== 'CLIENTE' || !cli.ativo) throw Erros.naoEncontrado('Cliente', [{ field: 'clienteId', issue: `Cliente ${input.clienteId} não existe` }]);
      clienteId = cli.id;
    }

    // 3) Unidade.
    const unidade = await prisma.unidade.findUnique({ where: { id: input.unidadeId } });
    if (!unidade || !unidade.ativa) throw Erros.naoEncontrado('Unidade', [{ field: 'unidadeId', issue: `Unidade ${input.unidadeId} não existe ou está inativa` }]);
    if (ator.perfil !== 'CLIENTE' && ator.perfil !== 'ADMIN' && ator.unidadeId !== unidade.id) {
      throw Erros.semPermissao('Funcionários só registram pedidos na própria unidade.');
    }

    // 4) Itens: existência, cardápio da unidade e preço.
    const itens = consolidarItens(input.itens);
    const produtoIds = itens.map((i) => i.produtoId);
    const [produtos, cardapio] = await Promise.all([
      prisma.produto.findMany({ where: { id: { in: produtoIds } } }),
      prisma.cardapioItem.findMany({ where: { unidadeId: unidade.id, produtoId: { in: produtoIds } } }),
    ]);
    const naoEncontrados: ErroDetalhe[] = [];
    const indisponiveis: ErroDetalhe[] = [];
    const linhas: LinhaPedido[] = [];
    const agora = new Date();
    itens.forEach((item, idx) => {
      const produto = produtos.find((p) => p.id === item.produtoId);
      if (!produto) {
        naoEncontrados.push({ field: `itens[${idx}].produtoId`, issue: `Produto ${item.produtoId} não existe` });
        return;
      }
      const ci = cardapio.find((c) => c.produtoId === item.produtoId);
      const motivo = ci
        ? motivoIndisponibilidade({ produtoAtivo: produto.ativo, disponivel: ci.disponivel, disponivelDe: ci.disponivelDe, disponivelAte: ci.disponivelAte, exigeCozinhaCompleta: produto.exigeCozinhaCompleta, tipoCozinhaUnidade: unidade.tipoCozinha }, agora)
        : 'Produto não faz parte do cardápio desta unidade.';
      if (motivo) {
        indisponiveis.push({ field: `itens[${idx}].produtoId`, issue: `${produto.nome}: ${motivo}` });
        return;
      }
      linhas.push({ produtoId: produto.id, quantidade: item.quantidade, precoUnitarioCentavos: paraCentavos(ci!.precoLocal ?? produto.precoBase) });
    });
    if (naoEncontrados.length) throw Erros.naoEncontrado('Produto', naoEncontrados);
    if (indisponiveis.length) throw Erros.conflito('PRODUTO_INDISPONIVEL', 'Um ou mais produtos não estão disponíveis nesta unidade.', indisponiveis);

    // 5) Subtotal, promoção, pontos e total.
    const subtotal = calcularSubtotalCentavos(linhas);
    let descontoPromo = 0;
    let promocaoId: number | null = null;
    if (input.codigoPromocao) {
      const promo = await prisma.promocao.findUnique({ where: { codigo: input.codigoPromocao.toUpperCase() } });
      if (!promo) throw new AppError(422, 'PROMOCAO_INVALIDA', 'Código de promoção inexistente.', [{ field: 'codigoPromocao', issue: 'Código não encontrado' }]);
      descontoPromo = calcularDescontoPromocaoCentavos(
        {
          codigo: promo.codigo,
          tipo: promo.tipo,
          valorCentavosOuPercentual: promo.tipo === 'PERCENTUAL' ? num(promo.valor) : paraCentavos(promo.valor),
          unidadeId: promo.unidadeId,
          canalPedido: promo.canalPedido,
          valorMinimoCentavos: paraCentavos(promo.valorMinimo),
          inicio: promo.inicio,
          fim: promo.fim,
          ativa: promo.ativa,
        },
        { unidadeId: unidade.id, canalPedido: input.canalPedido, subtotalCentavos: subtotal, agora },
      );
      promocaoId = promo.id;
    }

    const pontos = input.pontosResgatar ?? 0;
    let descontoPontos = 0;
    if (pontos > 0) {
      if (!clienteId) throw Erros.validacao('Resgate de pontos exige um cliente identificado.', [{ field: 'clienteId', issue: 'Obrigatório para resgatar pontos' }]);
      if (!(await temConsentimento(prisma, clienteId, 'FIDELIDADE')))
        throw Erros.conflito('CONSENTIMENTO_NECESSARIO', 'O cliente não possui consentimento ativo para o programa de fidelidade.');
      const conta = await prisma.contaFidelidade.findUnique({ where: { usuarioId: clienteId } });
      descontoPontos = calcularDescontoResgateCentavos(pontos, conta?.saldoPontos ?? 0, config.valorPonto, subtotal - descontoPromo);
    }
    const desconto = descontoPromo + descontoPontos;
    const total = Math.max(0, subtotal - desconto);

    // 6) Grava tudo numa transação.
    const pedido = await prisma.$transaction(async (tx) => {
      const p = await tx.pedido.create({
        data: {
          unidadeId: unidade.id,
          clienteId,
          operadorId: ator.perfil === 'CLIENTE' ? null : ator.id,
          canalPedido: input.canalPedido,
          status: 'AGUARDANDO_PAGAMENTO',
          formaPagamento: input.formaPagamento,
          subtotal: paraReais(subtotal),
          desconto: paraReais(desconto),
          total: paraReais(total),
          pontosResgatados: pontos,
          promocaoId,
          observacao: input.observacao,
          idempotencyKey: idempotencyKey ?? null,
          itens: {
            create: linhas.map((l) => ({
              produtoId: l.produtoId,
              quantidade: l.quantidade,
              precoUnitario: paraReais(l.precoUnitarioCentavos),
              subtotal: paraReais(l.precoUnitarioCentavos * l.quantidade),
            })),
          },
          historico: { create: { statusAnterior: null, statusNovo: 'AGUARDANDO_PAGAMENTO', usuarioId: ator.id } },
        },
      });
      await EstoqueService.reservar(tx, unidade.id, linhas, p.id, ator.id);
      if (pontos > 0 && clienteId) await FidelidadeService.debitarResgate(tx, clienteId, p.id, pontos);
      await this.audit.registrar(ctx, {
        acao: 'PEDIDO_CRIADO',
        entidade: 'Pedido',
        entidadeId: p.id,
        detalhes: { unidadeId: unidade.id, canalPedido: input.canalPedido, total: paraReais(total), itens: linhas.length, promocaoId, pontos },
      }, tx);
      return tx.pedido.findUniqueOrThrow({ where: { id: p.id }, include: includeCompleto });
    });

    return { pedido: apresentarPedido(pedido), reaproveitado: false };
  }

  async listar(ctx: Contexto, f: FiltroPedidos) {
    const { ator } = ctx;
    const { page, limit, skip, take } = paginar(f);
    const where: Prisma.PedidoWhereInput = {
      canalPedido: f.canalPedido,
      status: f.status,
      criadoEm: f.dataInicio || f.dataFim ? { gte: f.dataInicio ? new Date(f.dataInicio) : undefined, lte: f.dataFim ? new Date(f.dataFim) : undefined } : undefined,
    };
    // Cada perfil vê só o que pode.
    if (ator.perfil === 'CLIENTE') where.clienteId = ator.id;
    else if (ator.perfil === 'ADMIN') where.unidadeId = f.unidadeId;
    else {
      if (f.unidadeId && f.unidadeId !== ator.unidadeId) throw Erros.semPermissao('Você só pode consultar pedidos da sua unidade.');
      where.unidadeId = ator.unidadeId!;
    }
    const [data, total] = await Promise.all([
      prisma.pedido.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: includeCompleto }),
      prisma.pedido.count({ where }),
    ]);
    return { data: data.map(apresentarPedido), meta: metaPaginacao(page, limit, total) };
  }

  async obter(ctx: Contexto, id: number) {
    const p = await prisma.pedido.findUnique({ where: { id }, include: includeCompleto });
    this.garantirVisibilidade(ctx, p);
    return apresentarPedido(p!);
  }

  /** Cozinha muda para EM_PREPARO e PRONTO; balcão, para ENTREGUE. */
  async atualizarStatus(ctx: Contexto, id: number, novo: StatusPedido, observacao?: string) {
    const p = await prisma.pedido.findUnique({ where: { id } });
    this.garantirVisibilidade(ctx, p);
    if (ctx.ator.perfil === 'CLIENTE') throw Erros.semPermissao();
    const atual = p!.status as StatusPedido;
    validarMudancaOperacional(atual, novo, ctx.ator.perfil);

    const atualizado = await prisma.$transaction(async (tx) => {
      await this.trocarStatus(tx, id, atual, novo, ctx.ator.id, observacao);
      await this.audit.registrar(ctx, { acao: 'PEDIDO_STATUS_ALTERADO', entidade: 'Pedido', entidadeId: id, detalhes: { de: atual, para: novo } }, tx);
      return tx.pedido.findUniqueOrThrow({ where: { id }, include: includeCompleto });
    });
    return apresentarPedido(atualizado);
  }

  /** Cancela o pedido: devolve estoque e pontos e estorna o pagamento, se houver. */
  async cancelar(ctx: Contexto, id: number, motivo: string) {
    const p = await prisma.pedido.findUnique({ where: { id }, include: { itens: true, pagamentos: true } });
    this.garantirVisibilidade(ctx, p);
    const atual = p!.status as StatusPedido;
    validarCancelamento(atual, ctx.ator.perfil);

    // O estorno vem antes da transação, porque a chamada externa não participa dela.
    const pagamentoAprovado = p!.pagamentos.find((pg) => pg.status === 'APROVADO');
    let estornado = false;
    if (cancelamentoExigeEstorno(atual) && pagamentoAprovado?.transacaoExternaId) {
      const r = await this.gateway.estornar(pagamentoAprovado.transacaoExternaId, paraCentavos(pagamentoAprovado.valor));
      estornado = r.estornado;
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      await this.trocarStatus(tx, id, atual, 'CANCELADO', ctx.ator.id, motivo);
      await tx.pedido.update({ where: { id }, data: { motivoCancelamento: motivo } });
      if (cancelamentoDevolveEstoque(atual)) {
        await EstoqueService.devolver(tx, p!.unidadeId, p!.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })), id, ctx.ator.id);
      }
      await FidelidadeService.estornarPorCancelamento(tx, p!.clienteId, id);
      if (estornado && pagamentoAprovado) {
        await tx.pagamento.update({ where: { id: pagamentoAprovado.id }, data: { status: 'ESTORNADO' } });
      }
      await this.audit.registrar(ctx, {
        acao: 'PEDIDO_CANCELADO',
        entidade: 'Pedido',
        entidadeId: id,
        detalhes: { statusAnterior: atual, motivo, estoqueDevolvido: cancelamentoDevolveEstoque(atual), pagamentoEstornado: estornado },
      }, tx);
      return tx.pedido.findUniqueOrThrow({ where: { id }, include: includeCompleto });
    });
    return apresentarPedido(atualizado);
  }

  /**
   * Concorrência otimista: só atualiza se o status no banco
   * ainda for o que foi lido.
   */
  async trocarStatus(tx: Tx, id: number, atual: StatusPedido, novo: StatusPedido, usuarioId: number | null, observacao?: string) {
    const r = await tx.pedido.updateMany({ where: { id, status: atual }, data: { status: novo } });
    if (r.count === 0) throw Erros.conflito('CONFLITO_CONCORRENCIA', 'O pedido foi alterado por outra operação. Recarregue e tente novamente.');
    await tx.historicoStatusPedido.create({ data: { pedidoId: id, statusAnterior: atual, statusNovo: novo, usuarioId, observacao } });
  }

  /** Cliente vê só os próprios pedidos; funcionário, os da unidade. O 404 não revela se o pedido existe. */
  garantirVisibilidade(ctx: Contexto, p: { clienteId: number | null; unidadeId: number } | null) {
    const { ator } = ctx;
    if (!p) throw Erros.naoEncontrado('Pedido');
    if (ator.perfil === 'ADMIN') return;
    if (ator.perfil === 'CLIENTE' && p.clienteId !== ator.id) throw Erros.naoEncontrado('Pedido');
    if (ator.perfil !== 'CLIENTE' && p.unidadeId !== ator.unidadeId) throw Erros.naoEncontrado('Pedido');
  }
}
