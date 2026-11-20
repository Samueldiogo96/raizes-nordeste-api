import { calcularPontosGanhos } from '../../domain/fidelidade';
import { Erros } from '../../domain/errors';
import { prisma, Tx } from '../../infrastructure/database/prisma';
import { config } from '../../infrastructure/config';
import { metaPaginacao, paginar, Paginacao } from '../common';
import { Contexto } from '../ports';
import { temConsentimento } from './usuario.service';

export class FidelidadeService {
  async saldo(ctx: Contexto) {
    const conta = await prisma.contaFidelidade.findUnique({ where: { usuarioId: ctx.ator.id } });
    const consent = await temConsentimento(prisma, ctx.ator.id, 'FIDELIDADE');
    if (!conta) {
      throw Erros.conflito('SEM_PROGRAMA_FIDELIDADE', 'Você ainda não participa do programa. Conceda o consentimento FIDELIDADE.');
    }
    return {
      saldoPontos: conta.saldoPontos,
      valorEmReais: Math.round(conta.saldoPontos * config.valorPonto * 100) / 100,
      consentimentoAtivo: consent,
      regras: {
        pontosPorReal: config.pontosPorReal,
        valorPonto: config.valorPonto,
        limiteResgate: '50% do valor do pedido',
      },
    };
  }

  async extrato(ctx: Contexto, f: Partial<Paginacao>) {
    const conta = await prisma.contaFidelidade.findUnique({ where: { usuarioId: ctx.ator.id } });
    if (!conta) throw Erros.conflito('SEM_PROGRAMA_FIDELIDADE', 'Você ainda não participa do programa.');
    const { page, limit, skip, take } = paginar(f);
    const [data, total] = await Promise.all([
      prisma.transacaoPontos.findMany({ where: { contaId: conta.id }, skip, take, orderBy: { id: 'desc' } }),
      prisma.transacaoPontos.count({ where: { contaId: conta.id } }),
    ]);
    return { data, meta: metaPaginacao(page, limit, total) };
  }

  /** Credita pontos após pagamento aprovado, se houver consentimento. */
  static async creditarPorPagamento(tx: Tx, clienteId: number | null, pedidoId: number, totalPagoCentavos: number) {
    if (!clienteId) return 0;
    if (!(await temConsentimento(tx, clienteId, 'FIDELIDADE'))) return 0;
    const conta = await tx.contaFidelidade.findUnique({ where: { usuarioId: clienteId } });
    if (!conta) return 0;
    const pontos = calcularPontosGanhos(totalPagoCentavos, config.pontosPorReal);
    if (pontos <= 0) return 0;
    await tx.contaFidelidade.update({ where: { id: conta.id }, data: { saldoPontos: { increment: pontos } } });
    await tx.transacaoPontos.create({ data: { contaId: conta.id, tipo: 'ACUMULO', pontos, pedidoId, descricao: `Compra do pedido #${pedidoId}` } });
    return pontos;
  }

  static async debitarResgate(tx: Tx, clienteId: number, pedidoId: number, pontos: number) {
    const conta = await tx.contaFidelidade.findUniqueOrThrow({ where: { usuarioId: clienteId } });
    // Débito condicional evita saldo negativo em pedidos simultâneos.
    const r = await tx.contaFidelidade.updateMany({ where: { id: conta.id, saldoPontos: { gte: pontos } }, data: { saldoPontos: { decrement: pontos } } });
    if (r.count === 0) throw Erros.conflito('SALDO_PONTOS_INSUFICIENTE', 'Saldo de pontos insuficiente para o resgate.');
    await tx.transacaoPontos.create({ data: { contaId: conta.id, tipo: 'RESGATE', pontos: -pontos, pedidoId, descricao: `Resgate no pedido #${pedidoId}` } });
  }

  /** Cancelamento: devolve os pontos usados e retira os ganhos. */
  static async estornarPorCancelamento(tx: Tx, clienteId: number | null, pedidoId: number) {
    if (!clienteId) return;
    const conta = await tx.contaFidelidade.findUnique({ where: { usuarioId: clienteId } });
    if (!conta) return;
    const transacoes = await tx.transacaoPontos.findMany({ where: { contaId: conta.id, pedidoId } });
    const liquido = transacoes.reduce((acc, t) => acc + t.pontos, 0); // resgate (-) + acúmulo (+)
    if (liquido === 0) return;
    const ajuste = -liquido;
    const saldoFinal = Math.max(0, conta.saldoPontos + ajuste);
    await tx.contaFidelidade.update({ where: { id: conta.id }, data: { saldoPontos: saldoFinal } });
    await tx.transacaoPontos.create({ data: { contaId: conta.id, tipo: 'ESTORNO', pontos: saldoFinal - conta.saldoPontos, pedidoId, descricao: `Estorno do pedido #${pedidoId} cancelado` } });
  }
}
