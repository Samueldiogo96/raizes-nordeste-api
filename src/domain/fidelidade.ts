import { Erros } from './errors';

/**
 * Regras do programa de fidelização.
 * - Acúmulo: N pontos por real pago (padrão 1 ponto/R$), arredondado para baixo,
 *   creditados SOMENTE após pagamento aprovado e SOMENTE com consentimento FIDELIDADE ativo.
 * - Resgate: cada ponto vale R$ X (padrão R$ 0,05 → 100 pontos = R$ 5,00),
 *   limitado a 50% do valor do pedido (protege a margem da unidade).
 * - Cancelamento: pontos resgatados voltam; pontos acumulados pelo pedido são estornados.
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
