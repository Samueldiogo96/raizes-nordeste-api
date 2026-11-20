import { motivoIndisponibilidade } from '../../domain/cardapio';
import { Erros } from '../../domain/errors';
import { prisma } from '../../infrastructure/database/prisma';
import { garantirAcessoUnidade, metaPaginacao, num, paginar, Paginacao } from '../common';
import { AuditLogger, Contexto } from '../ports';

export class UnidadeService {
  constructor(private readonly audit: AuditLogger) {}

  async listar(filtros: Partial<Paginacao> & { regiao?: string; uf?: string }) {
    const { page, limit, skip, take } = paginar(filtros);
    const where = { ativa: true, regiao: filtros.regiao, uf: filtros.uf };
    const [data, total] = await Promise.all([
      prisma.unidade.findMany({ where, skip, take, orderBy: { id: 'asc' } }),
      prisma.unidade.count({ where }),
    ]);
    return { data, meta: metaPaginacao(page, limit, total) };
  }

  async obter(id: number) {
    const u = await prisma.unidade.findUnique({ where: { id } });
    if (!u) throw Erros.naoEncontrado('Unidade');
    return u;
  }

  async criar(ctx: Contexto, input: { nome: string; cidade: string; uf: string; regiao: string; tipoCozinha: string }) {
    const u = await prisma.unidade.create({ data: input });
    await this.audit.registrar(ctx, { acao: 'UNIDADE_CRIADA', entidade: 'Unidade', entidadeId: u.id });
    return u;
  }

  /**
   * Cardápio da unidade: considera disponibilidade, período sazonal,
   * tipo de cozinha e estoque. Usa o preço regional, se houver.
   */
  async cardapio(unidadeId: number, filtros: { categoria?: string; incluirIndisponiveis?: boolean }) {
    const unidade = await this.obter(unidadeId);
    const itens = await prisma.cardapioItem.findMany({
      where: { unidadeId, produto: { categoria: filtros.categoria } },
      include: { produto: true },
      orderBy: { produto: { nome: 'asc' } },
    });
    const estoques = await prisma.estoque.findMany({ where: { unidadeId } });
    const saldo = new Map(estoques.map((e) => [e.produtoId, e.quantidade]));
    const agora = new Date();

    const data = itens
      .map((i) => {
        let motivo = motivoIndisponibilidade(
          {
            produtoAtivo: i.produto.ativo,
            disponivel: i.disponivel,
            disponivelDe: i.disponivelDe,
            disponivelAte: i.disponivelAte,
            exigeCozinhaCompleta: i.produto.exigeCozinhaCompleta,
            tipoCozinhaUnidade: unidade.tipoCozinha,
          },
          agora,
        );
        if (!motivo && (saldo.get(i.produtoId) ?? 0) <= 0) motivo = 'Esgotado no momento.';
        return {
          produtoId: i.produtoId,
          nome: i.produto.nome,
          descricao: i.produto.descricao,
          categoria: i.produto.categoria,
          preco: num(i.precoLocal ?? i.produto.precoBase),
          sazonal: i.produto.sazonal,
          disponivel: motivo === null,
          motivoIndisponibilidade: motivo,
        };
      })
      .filter((i) => filtros.incluirIndisponiveis || i.disponivel);

    return { unidade: { id: unidade.id, nome: unidade.nome, tipoCozinha: unidade.tipoCozinha }, itens: data };
  }

  /** Gerente ajusta preço, disponibilidade e período sazonal da unidade. */
  async configurarItemCardapio(
    ctx: Contexto,
    unidadeId: number,
    produtoId: number,
    input: { precoLocal?: number | null; disponivel?: boolean; disponivelDe?: string | null; disponivelAte?: string | null },
  ) {
    garantirAcessoUnidade(ctx.ator, unidadeId);
    await this.obter(unidadeId);
    const produto = await prisma.produto.findUnique({ where: { id: produtoId } });
    if (!produto) throw Erros.naoEncontrado('Produto');

    const dados = {
      precoLocal: input.precoLocal === undefined ? undefined : input.precoLocal,
      disponivel: input.disponivel,
      disponivelDe: input.disponivelDe === undefined ? undefined : input.disponivelDe ? new Date(input.disponivelDe) : null,
      disponivelAte: input.disponivelAte === undefined ? undefined : input.disponivelAte ? new Date(input.disponivelAte) : null,
    };
    const item = await prisma.cardapioItem.upsert({
      where: { unidadeId_produtoId: { unidadeId, produtoId } },
      create: { unidadeId, produtoId, ...dados, disponivel: dados.disponivel ?? true },
      update: dados,
    });
    await prisma.estoque.upsert({
      where: { unidadeId_produtoId: { unidadeId, produtoId } },
      create: { unidadeId, produtoId, quantidade: 0 },
      update: {},
    });
    await this.audit.registrar(ctx, { acao: 'CARDAPIO_ALTERADO', entidade: 'CardapioItem', entidadeId: item.id, detalhes: { unidadeId, produtoId, ...input } });
    return { ...item, precoLocal: item.precoLocal === null ? null : num(item.precoLocal) };
  }
}
