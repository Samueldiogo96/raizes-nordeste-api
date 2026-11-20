import { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError, ZodSchema } from 'zod';
import { Contexto } from '../application/ports';
import { Perfil } from '../domain/enums';
import { AppError, Erros } from '../domain/errors';
import { logger } from '../infrastructure/logger';
import { tokens } from '../infrastructure/security/security';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      ctx?: Contexto;
    }
  }
}

/** Gera um id por requisição (ou usa o X-Request-Id recebido). */
export const requestId: RequestHandler = (req, res, next) => {
  const id = (req.header('x-request-id') ?? '').slice(0, 64) || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  const inicio = Date.now();
  res.on('finish', () => {
    // Não loga o corpo: pode ter senha ou dados pessoais.
    logger.info('http', { metodo: req.method, rota: req.originalUrl.split('?')[0], status: res.statusCode, ms: Date.now() - inicio, requestId: id, usuarioId: req.ctx?.ator.id });
  });
  next();
};

/** Exige JWT válido (Authorization: Bearer <token>). */
export const autenticar: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const [tipo, token] = header.split(' ');
  if (tipo !== 'Bearer' || !token) return next(Erros.naoAutenticado());
  try {
    const p = tokens.verificar(token);
    req.ctx = { ator: { id: p.sub, perfil: p.perfil, unidadeId: p.unidadeId }, requestId: req.requestId, ip: req.ip };
    next();
  } catch {
    next(Erros.naoAutenticado('Token inválido ou expirado.'));
  }
};

/** Restringe a rota a alguns perfis. */
export const autorizar = (...perfis: Perfil[]): RequestHandler => (req, _res, next) => {
  if (!req.ctx) return next(Erros.naoAutenticado());
  if (!perfis.includes(req.ctx.ator.perfil)) {
    return next(Erros.semPermissao(`Acesso permitido apenas para: ${perfis.join(', ')}.`));
  }
  next();
};

/** Valida body, query e params com zod. */
export const validar = (schemas: { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema }): RequestHandler => (req, _res, next) => {
  try {
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.query) (req as unknown as { validQuery: unknown }).validQuery = schemas.query.parse(req.query);
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  } catch (e) {
    next(e);
  }
};

export const q = <T>(req: Request): T => (req as unknown as { validQuery: T }).validQuery;

/** Repassa erros de handlers async ao middleware de erro. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

export const ctx = (req: Request): Contexto => req.ctx!;

/** 404 para rotas inexistentes, no mesmo formato de erro. */
export const rotaNaoEncontrada: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROTA_NAO_ENCONTRADA', `Rota ${req.method} ${req.path} não existe.`));
};

/**
 * Converte qualquer erro no formato padrão:
 * { error, message, details[], timestamp, path, requestId }
 * Erros inesperados viram 500, sem expor o stack trace.
 */
export function tratarErros(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let erro: AppError;
  if (err instanceof AppError) {
    erro = err;
  } else if (err instanceof ZodError) {
    erro = new AppError(422, 'VALIDACAO_FALHOU', 'Um ou mais campos são inválidos.',
      err.issues.map((i) => ({ field: i.path.join('.').replace(/\.(\d+)/g, '[$1]') || 'body', issue: i.message })));
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    erro = new AppError(400, 'JSON_MALFORMADO', 'O corpo da requisição não é um JSON válido.');
  } else if ((err as { status?: number })?.status === 429) {
    erro = new AppError(429, 'MUITAS_REQUISICOES', 'Muitas tentativas. Aguarde e tente novamente.');
  } else {
    logger.error('erro_nao_tratado', { requestId: req.requestId, erro: (err as Error)?.message, stack: (err as Error)?.stack });
    erro = new AppError(500, 'ERRO_INTERNO', 'Ocorreu um erro inesperado. Informe o requestId ao suporte.');
  }
  res.status(erro.status).json({
    error: erro.code,
    message: erro.message,
    details: erro.details,
    timestamp: new Date().toISOString(),
    path: req.originalUrl.split('?')[0],
    requestId: req.requestId,
  });
}
