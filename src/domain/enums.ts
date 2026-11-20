/**
 * Valores aceitos em cada campo. O SQLite não tem ENUM,
 * então a validação fica aqui e na API.
 */

export const CANAIS_PEDIDO = ['APP', 'TOTEM', 'BALCAO', 'PICKUP', 'WEB'] as const;
export type CanalPedido = (typeof CANAIS_PEDIDO)[number];

export const PERFIS = ['CLIENTE', 'ATENDENTE', 'COZINHA', 'GERENTE', 'ADMIN'] as const;
export type Perfil = (typeof PERFIS)[number];

/** Perfis que trabalham em uma unidade (precisam de unidadeId). */
export const PERFIS_FUNCIONARIO: Perfil[] = ['ATENDENTE', 'COZINHA', 'GERENTE'];

export const STATUS_PEDIDO = [
  'AGUARDANDO_PAGAMENTO',
  'PAGAMENTO_RECUSADO',
  'PAGO',
  'EM_PREPARO',
  'PRONTO',
  'ENTREGUE',
  'CANCELADO',
] as const;
export type StatusPedido = (typeof STATUS_PEDIDO)[number];

export const FORMAS_PAGAMENTO = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'MOCK'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const STATUS_PAGAMENTO = ['PENDENTE', 'APROVADO', 'RECUSADO', 'ERRO', 'ESTORNADO'] as const;
export type StatusPagamento = (typeof STATUS_PAGAMENTO)[number];

export const TIPOS_MOVIMENTACAO = ['ENTRADA', 'SAIDA', 'AJUSTE', 'ESTORNO'] as const;
export type TipoMovimentacao = (typeof TIPOS_MOVIMENTACAO)[number];

export const CATEGORIAS_PRODUTO = ['TAPIOCA', 'CUSCUZ', 'BOLO', 'BEBIDA', 'CAFE_DA_MANHA', 'SALGADO'] as const;
export type CategoriaProduto = (typeof CATEGORIAS_PRODUTO)[number];

export const TIPOS_COZINHA = ['COMPLETA', 'REDUZIDA'] as const;
export type TipoCozinha = (typeof TIPOS_COZINHA)[number];

export const REGIOES = ['NORDESTE', 'NORTE', 'CENTRO_OESTE', 'SUDESTE', 'SUL'] as const;
export type Regiao = (typeof REGIOES)[number];

export const FINALIDADES_CONSENTIMENTO = ['FIDELIDADE', 'MARKETING'] as const;
export type FinalidadeConsentimento = (typeof FINALIDADES_CONSENTIMENTO)[number];

export const TIPOS_PROMOCAO = ['PERCENTUAL', 'VALOR_FIXO'] as const;
export type TipoPromocao = (typeof TIPOS_PROMOCAO)[number];

/** Versão atual do termo de consentimento. */
export const VERSAO_TERMO_ATUAL = '2026.1';
