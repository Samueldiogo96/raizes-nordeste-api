import { Erros } from '../domain/errors';
import { Ator } from './ports';

export interface Paginacao {
  page: number;
  limit: number;
}

export function paginar(p: Partial<Paginacao>) {
  const page = Math.max(1, p.page ?? 1);
  const limit = Math.min(100, Math.max(1, p.limit ?? 10));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function metaPaginacao(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

/**
 * Escopo por unidade (multiunidade/franquia):
 * ADMIN (matriz) acessa todas; funcionários só a própria unidade.
 */
export function garantirAcessoUnidade(ator: Ator, unidadeId: number): void {
  if (ator.perfil === 'ADMIN') return;
  if (ator.perfil === 'CLIENTE' || ator.unidadeId !== unidadeId) {
    throw Erros.semPermissao('Você só pode operar dados da sua própria unidade.');
  }
}

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(String(v)));
