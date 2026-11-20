import { TipoMovimentacao } from '../../domain/enums';
import { ErroDetalhe, Erros } from '../../domain/errors';
import { prisma, Tx } from '../../infrastructure/database/prisma';
import { garantirAcessoUnidade, metaPaginacao, paginar, Paginacao } from '../common';
import { AuditLogger, Contexto } from '../ports';

/**
 * Estoque por unidade. Toda alteração fica registrada em movimentacoes_estoque.
 */
export class EstoqueService {
  constructor(private readonly audit: AuditLogger) {}

  async saldoPorUnidade(ctx: Contexto, unidadeId: number, f: { abaixoDoMinimo?: boolean }) {
    garantirAcessoUnidade(ctx.ator, unidadeId);
    const unidade = await prisma.unidade.findUnique({ where: { id: unidadeId } });
    if (!unidade) throw Erros.naoEncontrado('Unidade');
    const itens = await prisma.estoque.findMany({
      where: { unidadeId },
      include: { produto: { select: { nome: true, categoria: true } } },
      orderBy: { produtoId: 'asc' },
    });
    const data = itens
      .map((e) => ({
        produtoId: e.produtoId,
        produto: e.produto.nome,
        categoria: e.produto.categoria,
        quantidade: e.quantidade,
        estoqueMinimo: e.estoqueMinimo,
        abaixoDoMinimo: e.quantidade <= e.estoqueMinimo,
        atualizadoEm: e.atualizadoEm,
      }))
      .filter((e) => !f.abaixoDoMinimo || e.abaixoDoMinimo);
    return { unidadeId, unidade: unidade.nome, itens: data };
  }

  async movimentar(
    ctx: Contexto,
    input: { unidadeId: number; produtoId: number; tipo: Exclude<TipoMovimentacao, 'ESTORNO'>; quantidade: number; motivo?: string },
  ) {
    garantirAcessoUnidade(ctx.ator, input.unidadeId);
    const [unidade, produto] = await Promise.all([
      prisma.unidade.findUnique({ where: { id: input.unidadeId } }),
      prisma.produto.findUnique({ where: { id: input.produtoId } }),
    ]);
    if (!unidade) throw Erros.naoEncontrado('Unidade');
    if (!produto) throw Erros.naoEncontrado('Produto');
    if (input.tipo !== 'ENTRADA' && !input.motivo)
      throw Erros.validacao('Saídas e ajustes exigem motivo (auditoria).', [{ field: 'motivo', issue: 'Obrigatório para SAIDA e AJUSTE' }]);

    return prisma.$transaction(async (tx) => {
      const atual = await tx.estoque.upsert({
        where: { unidadeId_produtoId: { unidadeId: input.unidadeId, produtoId: input.produtoId } },
        create: { unidadeId: input.unidadeId, produtoId: input.produtoId, quantidade: 0 },
        update: {},
      });
      let novoSaldo: number;
      if (input.tipo === 'ENTRADA') novoSaldo = atual.quantidade + input.quantidade;
      else if (input.tipo === 'SAIDA') novoSaldo = atual.quantidade - input.quantidade;
      else novoSaldo = input.quantidade; // AJUSTE = contagem física (inventário)

      if (novoSaldo < 0) {
        throw Erros.conflito('ESTOQUE_INSUFICIENTE', 'A saída deixaria o estoque negativo.', [
          { field: 'quantidade', issue: `Disponível: ${atual.quantidade}` },
        ]);
      }
      await tx.estoque.update({ where: { id: atual.id }, data: { quantidade: novoSaldo } });
      const mov = await tx.movimentacaoEstoque.create({
        data: {
          unidadeId: input.unidadeId,
          produtoId: input.produtoId,
          tipo: input.tipo,
          quantidade: input.tipo === 'AJUSTE' ? novoSaldo - atual.quantidade : input.tipo === 'SAIDA' ? -input.quantidade : input.quantidade,
          saldoApos: novoSaldo,
          motivo: input.motivo,
          usuarioId: ctx.ator.id,
        },
      });
      await this.audit.registrar(ctx, { acao: `ESTOQUE_${input.tipo}`, entidade: 'Estoque', entidadeId: atual.id, detalhes: { unidadeId: input.unidadeId, produtoId: input.produtoId, de: atual.quantidade, para: novoSaldo, motivo: input.motivo } }, tx);
      return { movimentacaoId: mov.id, unidadeId: input.unidadeId, produtoId: input.produtoId, tipo: input.tipo, saldoAnterior: atual.quantidade, saldoAtual: novoSaldo, criadoEm: mov.criadoEm };
    });
  }

  async listarMovimentacoes(ctx: Contexto, f: Partial<Paginacao> & { unidadeId: number; produtoId?: number; tipo?: string }) {
    garantirAcessoUnidade(ctx.ator, f.unidadeId);
    const { page, limit, skip, take } = paginar(f);
    const where = { unidadeId: f.unidadeId, produtoId: f.produtoId, tipo: f.tipo };
    const [data, total] = await Promise.all([
      prisma.movimentacaoEstoque.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
      prisma.movimentacaoEstoque.count({ where }),
    ]);
    return { data, meta: metaPaginacao(page, limit, total) };
  }

  /**
   * Baixa o estoque dentro da transação do pedido. O UPDATE só ocorre
   * se houver quantidade suficiente, então dois pedidos simultâneos
   * não vendem a mesma última unidade.
   */
  static async reservar(tx: Tx, unidadeId: number, itens: { produtoId: number; quantidade: number }[], pedidoId: number, usuarioId: number) {
    const faltas: ErroDetalhe[] = [];
    for (const [idx, item] of itens.entries()) {
      const r = await tx.estoque.updateMany({
        where: { unidadeId, produtoId: item.produtoId, quantidade: { gte: item.quantidade } },
        data: { quantidade: { decrement: item.quantidade } },
      });
      if (r.count === 0) {
        const e = await tx.estoque.findUnique({ where: { unidadeId_produtoId: { unidadeId, produtoId: item.produtoId } } });
        faltas.push({ field: `itens[${idx}].quantidade`, issue: `Produto ${item.produtoId}: solicitado ${item.quantidade}, disponível ${e?.quantidade ?? 0}` });
        continue;
      }
      const e = await tx.estoque.findUniqueOrThrow({ where: { unidadeId_produtoId: { unidadeId, produtoId: item.produtoId } } });
      await tx.movimentacaoEstoque.create({
        data: { unidadeId, produtoId: item.produtoId, tipo: 'SAIDA', quantidade: -item.quantidade, saldoApos: e.quantidade, motivo: 'Venda (reserva do pedido)', pedidoId, usuarioId },
      });
    }
    if (faltas.length) {
      // O erro desfaz toda a transação.
      throw Erros.conflito('ESTOQUE_INSUFICIENTE', 'Não há quantidade suficiente para um ou mais itens.', faltas);
    }
  }

  static async devolver(tx: Tx, unidadeId: number, itens: { produtoId: number; quantidade: number }[], pedidoId: number, usuarioId: number) {
    for (const item of itens) {
      const e = await tx.estoque.update({
        where: { unidadeId_produtoId: { unidadeId, produtoId: item.produtoId } },
        data: { quantidade: { increment: item.quantidade } },
      });
      await tx.movimentacaoEstoque.create({
        data: { unidadeId, produtoId: item.produtoId, tipo: 'ESTORNO', quantidade: item.quantidade, saldoApos: e.quantidade, motivo: 'Cancelamento de pedido', pedidoId, usuarioId },
      });
    }
  }
}
