import { Erros } from '../../domain/errors';
import { prisma } from '../../infrastructure/database/prisma';
import { metaPaginacao, num, paginar, Paginacao } from '../common';
import { AuditLogger, Contexto } from '../ports';

export interface ProdutoInput {
  nome: string;
  descricao?: string;
  categoria: string;
  precoBase: number;
  exigeCozinhaCompleta?: boolean;
  sazonal?: boolean;
  ativo?: boolean;
}

const formatar = <T extends { precoBase: unknown }>(p: T) => ({ ...p, precoBase: num(p.precoBase) });

/** Catálogo central da rede (padrão da franquia), mantido pela matriz (ADMIN). */
export class ProdutoService {
  constructor(private readonly audit: AuditLogger) {}

  async listar(f: Partial<Paginacao> & { categoria?: string; busca?: string }) {
    const { page, limit, skip, take } = paginar(f);
    const where = { ativo: true, categoria: f.categoria, nome: f.busca ? { contains: f.busca } : undefined };
    const [data, total] = await Promise.all([
      prisma.produto.findMany({ where, skip, take, orderBy: { id: 'asc' } }),
      prisma.produto.count({ where }),
    ]);
    return { data: data.map(formatar), meta: metaPaginacao(page, limit, total) };
  }

  async obter(id: number) {
    const p = await prisma.produto.findUnique({ where: { id } });
    if (!p) throw Erros.naoEncontrado('Produto');
    return formatar(p);
  }

  async criar(ctx: Contexto, input: ProdutoInput) {
    const p = await prisma.produto.create({ data: input });
    await this.audit.registrar(ctx, { acao: 'PRODUTO_CRIADO', entidade: 'Produto', entidadeId: p.id });
    return formatar(p);
  }

  async atualizar(ctx: Contexto, id: number, input: Partial<ProdutoInput>) {
    const antes = await this.obter(id);
    const p = await prisma.produto.update({ where: { id }, data: input });
    await this.audit.registrar(ctx, {
      acao: 'PRODUTO_ATUALIZADO',
      entidade: 'Produto',
      entidadeId: id,
      detalhes: { antes: { precoBase: antes.precoBase, ativo: antes.ativo }, depois: input },
    });
    return formatar(p);
  }
}
