/**
 * Testes unitários das regras de domínio (sem banco e sem HTTP).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { motivoIndisponibilidade } from '../src/domain/cardapio';
import { AppError } from '../src/domain/errors';
import { calcularDescontoResgateCentavos, calcularPontosGanhos } from '../src/domain/fidelidade';
import { calcularSubtotalCentavos, consolidarItens, validarCanalParaPerfil, validarMudancaOperacional, validarTransicao } from '../src/domain/pedido';
import { calcularDescontoPromocaoCentavos } from '../src/domain/promocao';

const codigoDoErro = (fn: () => void) => {
  try { fn(); } catch (e) { return (e as AppError).code; }
  return null;
};

describe('Domínio — máquina de estados do pedido', () => {
  it('permite PAGO → EM_PREPARO → PRONTO → ENTREGUE', () => {
    validarTransicao('PAGO', 'EM_PREPARO');
    validarTransicao('EM_PREPARO', 'PRONTO');
    validarTransicao('PRONTO', 'ENTREGUE');
  });
  it('bloqueia pular etapas (AGUARDANDO_PAGAMENTO → EM_PREPARO)', () => {
    assert.equal(codigoDoErro(() => validarTransicao('AGUARDANDO_PAGAMENTO', 'EM_PREPARO')), 'TRANSICAO_STATUS_INVALIDA');
  });
  it('estados finais não mudam', () => {
    assert.equal(codigoDoErro(() => validarTransicao('ENTREGUE', 'CANCELADO')), 'TRANSICAO_STATUS_INVALIDA');
  });
  it('cozinha não pode marcar ENTREGUE', () => {
    assert.equal(codigoDoErro(() => validarMudancaOperacional('PRONTO', 'ENTREGUE', 'COZINHA')), 'ACESSO_NEGADO');
  });
  it('ninguém define PAGO manualmente', () => {
    assert.equal(codigoDoErro(() => validarMudancaOperacional('AGUARDANDO_PAGAMENTO', 'PAGO', 'ADMIN')), 'STATUS_CONTROLADO_PELO_PAGAMENTO');
  });
});

describe('Domínio — multicanalidade', () => {
  it('cliente não registra pedido de BALCAO', () => {
    assert.equal(codigoDoErro(() => validarCanalParaPerfil('BALCAO', 'CLIENTE')), 'CANAL_INVALIDO_PARA_PERFIL');
  });
  it('atendente registra BALCAO', () => {
    validarCanalParaPerfil('BALCAO', 'ATENDENTE');
  });
});

describe('Domínio — cálculos', () => {
  it('subtotal em centavos sem erro de ponto flutuante', () => {
    assert.equal(calcularSubtotalCentavos([{ produtoId: 1, quantidade: 3, precoUnitarioCentavos: 1890 }]), 5670);
  });
  it('consolida itens repetidos', () => {
    assert.deepEqual(consolidarItens([{ produtoId: 1, quantidade: 1 }, { produtoId: 1, quantidade: 2 }]), [{ produtoId: 1, quantidade: 3 }]);
  });
  it('pontos: 1 ponto por real, arredondado para baixo', () => {
    assert.equal(calcularPontosGanhos(4790, 1), 47);
  });
  it('resgate limitado a 50% do pedido', () => {
    assert.equal(codigoDoErro(() => calcularDescontoResgateCentavos(500, 500, 0.05, 2000)), 'RESGATE_ACIMA_DO_LIMITE');
    assert.equal(calcularDescontoResgateCentavos(100, 500, 0.05, 2000), 500);
  });
  it('promoção fora do canal é rejeitada', () => {
    const promo = { codigo: 'APP5', tipo: 'VALOR_FIXO', valorCentavosOuPercentual: 500, unidadeId: null, canalPedido: 'APP', valorMinimoCentavos: 0, inicio: new Date(0), fim: new Date(Date.now() + 1e9), ativa: true };
    assert.throws(() => calcularDescontoPromocaoCentavos(promo, { unidadeId: 1, canalPedido: 'TOTEM', subtotalCentavos: 5000, agora: new Date() }));
    assert.equal(calcularDescontoPromocaoCentavos(promo, { unidadeId: 1, canalPedido: 'APP', subtotalCentavos: 5000, agora: new Date() }), 500);
  });
  it('produto que exige cozinha completa é indisponível em unidade reduzida', () => {
    const motivo = motivoIndisponibilidade({ produtoAtivo: true, disponivel: true, disponivelDe: null, disponivelAte: null, exigeCozinhaCompleta: true, tipoCozinhaUnidade: 'REDUZIDA' }, new Date());
    assert.match(motivo!, /cozinha reduzida/);
  });
});
