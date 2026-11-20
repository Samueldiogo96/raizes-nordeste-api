import { CanalPedido, Perfil, StatusPedido } from './enums';
import { AppError, Erros } from './errors';

/**
 * Regras do pedido, sem acesso a banco ou HTTP.
 * Valores em centavos (inteiros) para evitar erro de arredondamento.
 */

/**
 * Transições de status permitidas:
 *
 * AGUARDANDO_PAGAMENTO → PAGO (gateway aprovou) | PAGAMENTO_RECUSADO | CANCELADO
 * PAGAMENTO_RECUSADO   → PAGO (nova tentativa aprovada) | PAGAMENTO_RECUSADO | CANCELADO
 * PAGO                 → EM_PREPARO | CANCELADO (com estorno)
 * EM_PREPARO           → PRONTO | CANCELADO (somente gerente/admin)
 * PRONTO               → ENTREGUE
 * ENTREGUE / CANCELADO → (estados finais)
 */
export const TRANSICOES: Record<StatusPedido, StatusPedido[]> = {
  AGUARDANDO_PAGAMENTO: ['PAGO', 'PAGAMENTO_RECUSADO', 'CANCELADO'],
  PAGAMENTO_RECUSADO: ['PAGO', 'PAGAMENTO_RECUSADO', 'CANCELADO'],
  PAGO: ['EM_PREPARO', 'CANCELADO'],
  EM_PREPARO: ['PRONTO', 'CANCELADO'],
  PRONTO: ['ENTREGUE'],
  ENTREGUE: [],
  CANCELADO: [],
};

/** Status definidos apenas pelo fluxo de pagamento. */
const STATUS_DE_PAGAMENTO: StatusPedido[] = ['PAGO', 'PAGAMENTO_RECUSADO'];

/** Perfis que podem mover o pedido para cada status (PATCH /status). */
const PERMISSAO_STATUS_OPERACIONAL: Partial<Record<StatusPedido, Perfil[]>> = {
  EM_PREPARO: ['COZINHA', 'GERENTE', 'ADMIN'],
  PRONTO: ['COZINHA', 'GERENTE', 'ADMIN'],
  ENTREGUE: ['ATENDENTE', 'GERENTE', 'ADMIN'],
};

export function validarTransicao(atual: StatusPedido, novo: StatusPedido): void {
  if (!TRANSICOES[atual].includes(novo)) {
    throw Erros.conflito(
      'TRANSICAO_STATUS_INVALIDA',
      `Não é possível alterar o pedido de ${atual} para ${novo}.`,
      [{ field: 'status', issue: `Transições permitidas a partir de ${atual}: ${TRANSICOES[atual].join(', ') || 'nenhuma'}` }],
    );
  }
}

/** Valida a mudança de status feita por um funcionário. */
export function validarMudancaOperacional(atual: StatusPedido, novo: StatusPedido, perfil: Perfil): void {
  if (STATUS_DE_PAGAMENTO.includes(novo)) {
    throw Erros.conflito(
      'STATUS_CONTROLADO_PELO_PAGAMENTO',
      'Os status PAGO e PAGAMENTO_RECUSADO são definidos apenas pelo fluxo de pagamento.',
    );
  }
  if (novo === 'CANCELADO') {
    throw Erros.requisicaoInvalida('Use POST /pedidos/{id}/cancelar para cancelar um pedido (exige motivo).');
  }
  const permitidos = PERMISSAO_STATUS_OPERACIONAL[novo] ?? [];
  if (!permitidos.includes(perfil)) {
    throw Erros.semPermissao(`O perfil ${perfil} não pode mover pedidos para ${novo}.`);
  }
  validarTransicao(atual, novo);
}

/** Regras de cancelamento por perfil. */
export function validarCancelamento(atual: StatusPedido, perfil: Perfil): void {
  validarTransicao(atual, 'CANCELADO');
  const cancelaveisPeloCliente: StatusPedido[] = ['AGUARDANDO_PAGAMENTO', 'PAGAMENTO_RECUSADO'];
  if (perfil === 'CLIENTE' && !cancelaveisPeloCliente.includes(atual)) {
    throw Erros.conflito(
      'CANCELAMENTO_NAO_PERMITIDO',
      'O cliente só pode cancelar pedidos que ainda não foram pagos. Procure o atendimento da unidade.',
    );
  }
  if (atual === 'EM_PREPARO' && !['GERENTE', 'ADMIN'].includes(perfil)) {
    throw Erros.semPermissao('Pedidos em preparo só podem ser cancelados pelo gerente.');
  }
}

/** Status em que o cancelamento devolve o estoque reservado. */
export function cancelamentoDevolveEstoque(atual: StatusPedido): boolean {
  // Em preparo, o insumo já foi usado e não volta ao estoque.
  return ['AGUARDANDO_PAGAMENTO', 'PAGAMENTO_RECUSADO', 'PAGO'].includes(atual);
}

/** Status com pagamento aprovado: cancelar exige estorno. */
export function cancelamentoExigeEstorno(atual: StatusPedido): boolean {
  return ['PAGO', 'EM_PREPARO'].includes(atual);
}

/**
 * Canais permitidos por perfil:
 * - CLIENTE: APP, WEB, TOTEM, PICKUP
 * - ATENDENTE/GERENTE: BALCAO
 * - ADMIN: qualquer canal
 */
export function validarCanalParaPerfil(canal: CanalPedido, perfil: Perfil): void {
  const permitidos: Record<Perfil, CanalPedido[]> = {
    CLIENTE: ['APP', 'WEB', 'TOTEM', 'PICKUP'],
    ATENDENTE: ['BALCAO'],
    GERENTE: ['BALCAO'],
    COZINHA: [],
    ADMIN: ['APP', 'WEB', 'TOTEM', 'PICKUP', 'BALCAO'],
  };
  if (!permitidos[perfil].includes(canal)) {
    throw new AppError(
      422,
      'CANAL_INVALIDO_PARA_PERFIL',
      `O perfil ${perfil} não pode registrar pedidos pelo canal ${canal}.`,
      [{ field: 'canalPedido', issue: `Canais permitidos: ${permitidos[perfil].join(', ') || 'nenhum'}` }],
    );
  }
}

export interface LinhaPedido {
  produtoId: number;
  quantidade: number;
  precoUnitarioCentavos: number;
}

export function calcularSubtotalCentavos(linhas: LinhaPedido[]): number {
  return linhas.reduce((acc, l) => acc + l.precoUnitarioCentavos * l.quantidade, 0);
}

/** Junta itens repetidos do mesmo produto numa linha só. */
export function consolidarItens(itens: { produtoId: number; quantidade: number }[]) {
  const mapa = new Map<number, number>();
  for (const i of itens) mapa.set(i.produtoId, (mapa.get(i.produtoId) ?? 0) + i.quantidade);
  return [...mapa.entries()].map(([produtoId, quantidade]) => ({ produtoId, quantidade }));
}

export const paraCentavos = (valor: number | string | { toString(): string }): number =>
  Math.round(Number(valor.toString()) * 100);
export const paraReais = (centavos: number): number => Math.round(centavos) / 100;
