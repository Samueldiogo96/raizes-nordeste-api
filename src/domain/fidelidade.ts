import { Erros } from './errors';

/**
 * Fidelidade:
 * - acúmulo: pontos por real pago (padrão 1 por R$), só após pagamento aprovado
 *   e com consentimento de fidelidade ativo;
 * - resgate: cada ponto vale R$ 0,05 por padrão, até 50% do pedido;
 * - cancelamento: devolve os pontos usados e retira os ganhos.
 */
export const LIMITE_RESGATE_PERCENTUAL = 0.5;

export function calcularPontosGanhos(totalPagoCentavos: number, pontosPorReal: number): number {
  return Math.floor((totalPagoCentavos / 100) * pontosPorReal);
}

export function calcularDescontoResgateCentavos(
  pontos: number,
  saldo: number,
  valorPontoReais: number,
  baseCentavos: number,
): number {
  if (pontos <= 0) return 0;
  if (pontos > saldo) {
    throw Erros.conflito('SALDO_PONTOS_INSUFICIENTE', 'Saldo de pontos insuficiente para o resgate.', [
      { field: 'pontosResgatar', issue: `Saldo disponível: ${saldo}` },
    ]);
  }
  const desconto = Math.round(pontos * valorPontoReais * 100);
  const limite = Math.floor(baseCentavos * LIMITE_RESGATE_PERCENTUAL);
  if (desconto > limite) {
    const maxPontos = Math.floor(limite / (valorPontoReais * 100));
    throw Erros.conflito(
      'RESGATE_ACIMA_DO_LIMITE',
      'O resgate de pontos não pode ultrapassar 50% do valor do pedido.',
      [{ field: 'pontosResgatar', issue: `Máximo de pontos para este pedido: ${maxPontos}` }],
    );
  }
  return desconto;
}
