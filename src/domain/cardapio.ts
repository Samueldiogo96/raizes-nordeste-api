/**
 * Regras de disponibilidade de um produto no cardápio de uma unidade.
 * Um produto só pode ser vendido se:
 *  - o produto está ativo na rede;
 *  - está marcado como disponível no cardápio daquela unidade;
 *  - a data atual está dentro da janela sazonal (ex.: itens juninos);
 *  - a unidade tem cozinha COMPLETA quando o produto exige.
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
