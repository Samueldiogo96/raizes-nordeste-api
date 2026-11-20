import { AppError } from './errors';

/**
 * Uma promoção pode valer só para uma unidade ou canal, tem período de
 * vigência e valor mínimo. Cada pedido aceita uma promoção.
 */
export interface PromocaoRegra {
  codigo: string;
  tipo: string; // PERCENTUAL | VALOR_FIXO
  valorCentavosOuPercentual: number; // percentual (ex.: 10) ou centavos (ex.: 500)
  unidadeId: number | null;
  canalPedido: string | null;
  valorMinimoCentavos: number;
  inicio: Date;
  fim: Date;
  ativa: boolean;
}

export function calcularDescontoPromocaoCentavos(
  promo: PromocaoRegra,
  ctx: { unidadeId: number; canalPedido: string; subtotalCentavos: number; agora: Date },
): number {
  const invalida = (issue: string) =>
    new AppError(422, 'PROMOCAO_INVALIDA', 'A promoção informada não pode ser aplicada a este pedido.', [
      { field: 'codigoPromocao', issue },
    ]);

  if (!promo.ativa) throw invalida('Promoção inativa.');
  if (ctx.agora < promo.inicio || ctx.agora > promo.fim) throw invalida('Promoção fora do período de vigência.');
  if (promo.unidadeId !== null && promo.unidadeId !== ctx.unidadeId) throw invalida('Promoção não vale para esta unidade.');
  if (promo.canalPedido !== null && promo.canalPedido !== ctx.canalPedido)
    throw invalida(`Promoção válida apenas no canal ${promo.canalPedido}.`);
  if (ctx.subtotalCentavos < promo.valorMinimoCentavos)
    throw invalida(`Valor mínimo do pedido: R$ ${(promo.valorMinimoCentavos / 100).toFixed(2)}.`);

  const desconto =
    promo.tipo === 'PERCENTUAL'
      ? Math.round((ctx.subtotalCentavos * promo.valorCentavosOuPercentual) / 100)
      : promo.valorCentavosOuPercentual;
  return Math.min(desconto, ctx.subtotalCentavos);
}
