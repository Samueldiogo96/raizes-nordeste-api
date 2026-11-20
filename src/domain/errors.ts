/**
 * Erro com código, status HTTP e detalhes. O middleware de erro
 * transforma em JSON no formato padrão da API.
 */
export interface ErroDetalhe {
  field: string;
  issue: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ErroDetalhe[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Erros = {
  validacao: (message: string, details: ErroDetalhe[] = []) =>
    new AppError(422, 'VALIDACAO_FALHOU', message, details),
  requisicaoInvalida: (message: string) => new AppError(400, 'REQUISICAO_INVALIDA', message),
  naoAutenticado: (message = 'Token de acesso ausente ou inválido.') =>
    new AppError(401, 'NAO_AUTENTICADO', message),
  credenciaisInvalidas: () => new AppError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha inválidos.'),
  semPermissao: (message = 'Seu perfil não tem permissão para esta operação.') =>
    new AppError(403, 'ACESSO_NEGADO', message),
  naoEncontrado: (recurso: string, details: ErroDetalhe[] = []) =>
    new AppError(404, `${recurso.toUpperCase()}_NAO_ENCONTRADO`, `${recurso} não encontrado(a).`, details),
  conflito: (code: string, message: string, details: ErroDetalhe[] = []) =>
    new AppError(409, code, message, details),
  gatewayIndisponivel: (message: string) => new AppError(502, 'GATEWAY_PAGAMENTO_INDISPONIVEL', message),
};
