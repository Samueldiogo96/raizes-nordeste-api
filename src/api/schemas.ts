import { z } from 'zod';
import {
  CANAIS_PEDIDO, CATEGORIAS_PRODUTO, FINALIDADES_CONSENTIMENTO, FORMAS_PAGAMENTO, PERFIS,
  REGIOES, STATUS_PEDIDO, TIPOS_COZINHA, TIPOS_MOVIMENTACAO, TIPOS_PROMOCAO,
} from '../domain/enums';

/** Contratos de entrada (DTOs) validados na borda da API. */

const msgEnum = (valores: readonly string[]) => ({
  errorMap: (_issue: z.ZodIssueOptionalMessage, ctx: { data: unknown }) => ({
    message: ctx.data === undefined
      ? `Campo obrigatório. Aceitos: ${valores.join(', ')}`
      : `Valor inválido. Aceitos: ${valores.join(', ')}`,
  }),
});
const enumz = <T extends readonly [string, ...string[]]>(v: T) => z.enum(v, msgEnum(v));

export const idParam = z.object({ id: z.coerce.number().int().positive('id deve ser inteiro positivo') });

export const paginacao = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const senhaForte = z
  .string({ required_error: 'Campo obrigatório' })
  .min(8, 'Mínimo de 8 caracteres')
  .max(72)
  .regex(/[A-Za-z]/, 'Deve conter letras')
  .regex(/\d/, 'Deve conter números');

// ------------------------------------------------------------------ Auth / Usuários
export const registrarSchema = z.object({
  nome: z.string({ required_error: 'Campo obrigatório' }).trim().min(2).max(120),
  email: z.string({ required_error: 'Campo obrigatório' }).email('E-mail inválido'),
  senha: senhaForte,
  telefone: z.string().regex(/^\+?\d{10,13}$/, 'Telefone deve ter 10 a 13 dígitos').optional(),
  dataNascimento: z.string().date('Use o formato AAAA-MM-DD').optional(),
  consentimentoFidelidade: z.boolean({ required_error: 'Informe se aceita o programa de fidelidade' }),
  consentimentoMarketing: z.boolean().default(false),
  canal: enumz(CANAIS_PEDIDO).optional(),
});

export const loginSchema = z.object({
  email: z.string({ required_error: 'Campo obrigatório' }).email('E-mail inválido'),
  senha: z.string({ required_error: 'Campo obrigatório' }).min(1),
});

export const criarFuncionarioSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().email('E-mail inválido'),
  senha: senhaForte,
  perfil: enumz(PERFIS),
  unidadeId: z.number().int().positive().optional(),
});

export const consentimentoSchema = z.object({
  finalidade: enumz(FINALIDADES_CONSENTIMENTO),
  concedido: z.boolean({ required_error: 'Campo obrigatório' }),
  canal: enumz(CANAIS_PEDIDO).optional(),
});

// ------------------------------------------------------------------ Unidades / Produtos
export const unidadeSchema = z.object({
  nome: z.string().trim().min(2),
  cidade: z.string().trim().min(2),
  uf: z.string().length(2).toUpperCase(),
  regiao: enumz(REGIOES),
  tipoCozinha: enumz(TIPOS_COZINHA),
});
export const listarUnidadesQuery = paginacao.extend({ regiao: enumz(REGIOES).optional(), uf: z.string().length(2).toUpperCase().optional() });

export const cardapioQuery = z.object({
  categoria: enumz(CATEGORIAS_PRODUTO).optional(),
  incluirIndisponiveis: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export const cardapioItemParams = z.object({ id: z.coerce.number().int().positive(), produtoId: z.coerce.number().int().positive() });
export const cardapioItemSchema = z.object({
  precoLocal: z.number().positive().multipleOf(0.01).nullable().optional(),
  disponivel: z.boolean().optional(),
  disponivelDe: z.string().datetime({ offset: true }).nullable().optional(),
  disponivelAte: z.string().datetime({ offset: true }).nullable().optional(),
});

export const produtoSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  descricao: z.string().max(500).optional(),
  categoria: enumz(CATEGORIAS_PRODUTO),
  precoBase: z.number({ required_error: 'Campo obrigatório' }).positive('Preço deve ser maior que zero').multipleOf(0.01),
  exigeCozinhaCompleta: z.boolean().optional(),
  sazonal: z.boolean().optional(),
  ativo: z.boolean().optional(),
});
export const listarProdutosQuery = paginacao.extend({ categoria: enumz(CATEGORIAS_PRODUTO).optional(), busca: z.string().max(60).optional() });

// ------------------------------------------------------------------ Estoque
export const movimentacaoSchema = z.object({
  unidadeId: z.number({ required_error: 'Campo obrigatório' }).int().positive(),
  produtoId: z.number({ required_error: 'Campo obrigatório' }).int().positive(),
  tipo: z.enum(['ENTRADA', 'SAIDA', 'AJUSTE'], msgEnum(['ENTRADA', 'SAIDA', 'AJUSTE'])),
  quantidade: z.number({ required_error: 'Campo obrigatório' }).int('Quantidade deve ser inteira').min(0, 'Quantidade não pode ser negativa'),
  motivo: z.string().max(200).optional(),
}).refine((d) => d.tipo === 'AJUSTE' || d.quantidade > 0, { message: 'Quantidade deve ser maior que zero', path: ['quantidade'] });
export const saldoQuery = z.object({ abaixoDoMinimo: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
export const movimentacoesQuery = paginacao.extend({
  unidadeId: z.coerce.number({ required_error: 'unidadeId é obrigatório' }).int().positive(),
  produtoId: z.coerce.number().int().positive().optional(),
  tipo: enumz(TIPOS_MOVIMENTACAO).optional(),
});

// ------------------------------------------------------------------ Pedidos
export const criarPedidoSchema = z.object({
  unidadeId: z.number({ required_error: 'Campo obrigatório' }).int().positive(),
  canalPedido: enumz(CANAIS_PEDIDO),
  clienteId: z.number().int().positive().optional(),
  itens: z
    .array(z.object({
      produtoId: z.number({ required_error: 'Campo obrigatório' }).int().positive(),
      quantidade: z.number({ required_error: 'Campo obrigatório' }).int('Quantidade deve ser inteira').min(1, 'Quantidade deve ser no mínimo 1').max(50, 'Máximo de 50 unidades por item'),
    }), { required_error: 'Campo obrigatório' })
    .min(1, 'O pedido precisa de pelo menos 1 item')
    .max(30),
  formaPagamento: enumz(FORMAS_PAGAMENTO),
  codigoPromocao: z.string().max(30).optional(),
  pontosResgatar: z.number().int().min(0).optional(),
  observacao: z.string().max(300).optional(),
});

export const listarPedidosQuery = paginacao.extend({
  canalPedido: enumz(CANAIS_PEDIDO).optional(),
  status: enumz(STATUS_PEDIDO).optional(),
  unidadeId: z.coerce.number().int().positive().optional(),
  dataInicio: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  dataFim: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

export const statusSchema = z.object({
  status: enumz(STATUS_PEDIDO),
  observacao: z.string().max(200).optional(),
});

export const cancelarSchema = z.object({
  motivo: z.string({ required_error: 'Informe o motivo do cancelamento' }).trim().min(5, 'Motivo deve ter ao menos 5 caracteres').max(300),
});

// ------------------------------------------------------------------ Pagamentos
export const pagamentoSchema = z.object({
  pedidoId: z.number({ required_error: 'Campo obrigatório' }).int().positive(),
  tokenPagamento: z.string().min(3).max(100).optional(),
});

export const webhookSchema = z.object({
  transacaoId: z.string().min(1),
  status: z.enum(['APROVADO', 'RECUSADO']),
  motivo: z.string().max(200).optional(),
});

// ------------------------------------------------------------------ Promoções / Relatórios / Auditoria
export const promocaoSchema = z.object({
  codigo: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/, 'Use letras, números, _ ou -'),
  descricao: z.string().min(3).max(200),
  tipo: enumz(TIPOS_PROMOCAO),
  valor: z.number().positive(),
  unidadeId: z.number().int().positive().optional(),
  canalPedido: enumz(CANAIS_PEDIDO).optional(),
  valorMinimo: z.number().min(0).optional(),
  inicio: z.string().datetime({ offset: true }),
  fim: z.string().datetime({ offset: true }),
});
export const promocoesQuery = z.object({ unidadeId: z.coerce.number().int().positive().optional(), canalPedido: enumz(CANAIS_PEDIDO).optional() });

export const relatorioVendasQuery = z.object({
  agruparPor: z.enum(['unidade', 'regiao', 'canal', 'dia']).default('unidade'),
  dataInicio: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  dataFim: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  unidadeId: z.coerce.number().int().positive().optional(),
});
export const maisVendidosQuery = z.object({
  limite: z.coerce.number().int().min(1).max(50).default(10),
  unidadeId: z.coerce.number().int().positive().optional(),
});
export const auditoriaQuery = paginacao.extend({
  acao: z.string().max(60).optional(),
  entidade: z.string().max(60).optional(),
  entidadeId: z.string().max(30).optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
});
