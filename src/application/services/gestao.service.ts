import { Erros } from '../../domain/errors';
import { prisma } from '../../infrastructure/database/prisma';
import { metaPaginacao, num, paginar, Paginacao } from '../common';
import { AuditLogger, Contexto } from '../ports';

const STATUS_VENDA_EFETIVADA = ['PAGO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE'];

/** Promoções, relatórios gerenciais (matriz/unidade) e consulta da trilha de auditoria. */
export class GestaoService {
  constructor(private readonly audit: AuditLogger) {}

  // ------------------------------------------------------------ Promoções
  async listarPromocoesVigentes(f: { unidadeId?: number; canalPedido?: string }) {
    const agora = new Date();
    const lista = await prisma.promocao.findMany({
      where: {
        ativa: true,
        inicio: { lte: agora },
        fim: { gte: agora },
        AND: [
          f.unidadeId ? { OR: [{ unidadeId: null }, { unidadeId: f.unidadeId }] } : {},
          f.canalPedido ? { OR: [{ canalPedido: null }, { canalPedido: f.canalPedido }] } : {},
        ],
      },
      orderBy: { fim: 'asc' },
    });
    return lista.map((p) => ({ ...p, valor: num(p.valor), valorMinimo: num(p.valorMinimo) }));
  }

  async criarPromocao(ctx: Contexto, input: { codigo: string; descricao: string; tipo: string; valor: number; unidadeId?: number; canalPedido?: string; valorMinimo?: number; inicio: string; fim: string }) {
    if (new Date(input.fim) <= new Date(input.inicio)) throw Erros.validacao('Período inválido.', [{ field: 'fim', issue: 'Deve ser posterior a inicio' }]);
    if (input.tipo === 'PERCENTUAL' && input.valor > 100) throw Erros.validacao('Percentual acima de 100%.', [{ field: 'valor', issue: 'Máximo 100' }]);
    const codigo = input.codigo.toUpperCase();
    if (await prisma.promocao.findUnique({ where: { codigo } })) throw Erros.conflito('PROMOCAO_JA_EXISTE', 'Já existe promoção com este código.');
    const p = await prisma.promocao.create({ data: { ...input, codigo, inicio: new Date(input.inicio), fim: new Date(input.fim), valorMinimo: input.valorMinimo ?? 0 } });
    await this.audit.registrar(ctx, { acao: 'PROMOCAO_CRIADA', entidade: 'Promocao', entidadeId: p.id, detalhes: { codigo, tipo: p.tipo, valor: input.valor } });
    return { ...p, valor: num(p.valor), valorMinimo: num(p.valorMinimo) };
  }

  // ------------------------------------------------------------ Relatórios
  /**
   * Vendas consolidadas por unidade, região, canal ou dia. Gerente vê apenas a própria unidade;
   * a matriz (ADMIN) vê a rede inteira. Em produção, rodaria numa réplica de leitura / data warehouse
   * para não competir com o fluxo de pedidos no horário de pico.
   */
  async relatorioVendas(ctx: Contexto, f: { agruparPor: 'unidade' | 'regiao' | 'canal' | 'dia'; dataInicio?: string; dataFim?: string; unidadeId?: number }) {
    const unidadeId = ctx.ator.perfil === 'ADMIN' ? f.unidadeId : ctx.ator.unidadeId!;
    if (ctx.ator.perfil !== 'ADMIN' && f.unidadeId && f.unidadeId !== ctx.ator.unidadeId) throw Erros.semPermissao('Gerentes só veem relatórios da própria unidade.');
    const pedidos = await prisma.pedido.findMany({
      where: {
        status: { in: STATUS_VENDA_EFETIVADA },
        unidadeId,
        criadoEm: { gte: f.dataInicio ? new Date(f.dataInicio) : undefined, lte: f.dataFim ? new Date(f.dataFim) : undefined },
      },
      include: { unidade: true },
    });
    const grupos = new Map<string, { chave: string; pedidos: number; faturamento: number; descontos: number }>();
    for (const p of pedidos) {
      const chave =
        f.agruparPor === 'unidade' ? `${p.unidade.id} - ${p.unidade.nome}` :
        f.agruparPor === 'regiao' ? p.unidade.regiao :
        f.agruparPor === 'canal' ? p.canalPedido :
        p.criadoEm.toISOString().slice(0, 10);
      const g = grupos.get(chave) ?? { chave, pedidos: 0, faturamento: 0, descontos: 0 };
      g.pedidos++;
      g.faturamento += num(p.total);
      g.descontos += num(p.desconto);
      grupos.set(chave, g);
    }
    const linhas = [...grupos.values()]
      .map((g) => ({ ...g, faturamento: +g.faturamento.toFixed(2), descontos: +g.descontos.toFixed(2), ticketMedio: +(g.faturamento / g.pedidos).toFixed(2) }))
      .sort((a, b) => b.faturamento - a.faturamento);
    const total = linhas.reduce((a, l) => a + l.faturamento, 0);
    return { agruparPor: f.agruparPor, periodo: { inicio: f.dataInicio ?? null, fim: f.dataFim ?? null }, totalPedidos: pedidos.length, faturamentoTotal: +total.toFixed(2), linhas };
  }

  async produtosMaisVendidos(ctx: Contexto, f: { limite?: number; unidadeId?: number }) {
    const unidadeId = ctx.ator.perfil === 'ADMIN' ? f.unidadeId : ctx.ator.unidadeId!;
    const itens = await prisma.itemPedido.groupBy({
      by: ['produtoId'],
      where: { pedido: { status: { in: STATUS_VENDA_EFETIVADA }, unidadeId } },
      _sum: { quantidade: true, subtotal: true },
      orderBy: { _sum: { quantidade: 'desc' } },
      take: Math.min(f.limite ?? 10, 50),
    });
    const produtos = await prisma.produto.findMany({ where: { id: { in: itens.map((i) => i.produtoId) } } });
    return itens.map((i, pos) => ({
      posicao: pos + 1,
      produtoId: i.produtoId,
      nome: produtos.find((p) => p.id === i.produtoId)?.nome,
      quantidadeVendida: i._sum.quantidade ?? 0,
      faturamento: num(i._sum.subtotal),
    }));
  }

  // ------------------------------------------------------------ Auditoria
  async listarAuditoria(f: Partial<Paginacao> & { acao?: string; entidade?: string; entidadeId?: string; usuarioId?: number }) {
    const { page, limit, skip, take } = paginar(f);
    const where = { acao: f.acao, entidade: f.entidade, entidadeId: f.entidadeId, usuarioId: f.usuarioId };
    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
      prisma.auditLog.count({ where }),
    ]);
    return { data: data.map((a) => ({ ...a, detalhes: a.detalhes ? JSON.parse(a.detalhes) : null })), meta: metaPaginacao(page, limit, total) };
  }
}
