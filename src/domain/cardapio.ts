/**
 * Um produto só pode ser vendido na unidade se estiver ativo, disponível
 * no cardápio dela, dentro do período sazonal (se houver) e, quando exigir,
 * se a unidade tiver cozinha completa.
 */
export interface ItemCardapioRegra {
  produtoAtivo: boolean;
  disponivel: boolean;
  disponivelDe: Date | null;
  disponivelAte: Date | null;
  exigeCozinhaCompleta: boolean;
  tipoCozinhaUnidade: string;
}

export function motivoIndisponibilidade(item: ItemCardapioRegra, agora: Date): string | null {
  if (!item.produtoAtivo) return 'Produto descontinuado na rede.';
  if (!item.disponivel) return 'Produto indisponível nesta unidade.';
  if (item.disponivelDe && agora < item.disponivelDe) return 'Produto sazonal ainda não disponível.';
  if (item.disponivelAte && agora > item.disponivelAte) return 'Produto sazonal fora de temporada.';
  if (item.exigeCozinhaCompleta && item.tipoCozinhaUnidade !== 'COMPLETA')
    return 'Unidade com cozinha reduzida não produz este item.';
  return null;
}
