import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { services } from '../../container';
import { config } from '../../infrastructure/config';
import { autenticar, autorizar, ctx, h, validar } from '../middlewares';
import { consentimentoSchema, criarFuncionarioSchema, idParam, loginSchema, registrarSchema } from '../schemas';

export const authRouter = Router();
export const usuariosRouter = Router();

/**
 * Proteção contra força bruta no login: no máximo 5 tentativas FALHAS por minuto
 * para a mesma combinação IP + e-mail (logins bem-sucedidos não contam).
 */
const limiteLogin = rateLimit({
  windowMs: 60_000,
  limit: config.isTest ? 1000 : 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next({ status: 429 }),
});

// ---------------------------------------------------------------- /auth
authRouter.post('/registrar', validar({ body: registrarSchema }), h(async (req, res) => {
  res.status(201).json(await services.auth.registrarCliente(req.body));
}));

authRouter.post('/login', limiteLogin, validar({ body: loginSchema }), h(async (req, res) => {
  res.json(await services.auth.login(req.body.email, req.body.senha, req.ip));
}));

// ---------------------------------------------------------------- /usuarios
usuariosRouter.use(autenticar);

usuariosRouter.get('/me', h(async (req, res) => {
  res.json(await services.usuarios.meusDados(ctx(req)));
}));

usuariosRouter.get('/me/exportar', h(async (req, res) => {
  res.json(await services.usuarios.exportarMeusDados(ctx(req)));
}));

usuariosRouter.post('/me/consentimentos', autorizar('CLIENTE'), validar({ body: consentimentoSchema }), h(async (req, res) => {
  res.json(await services.usuarios.registrarConsentimento(ctx(req), req.body.finalidade, req.body.concedido, req.body.canal));
}));

usuariosRouter.delete('/me', autorizar('CLIENTE'), h(async (req, res) => {
  await services.usuarios.anonimizarMinhaConta(ctx(req));
  res.status(204).send();
}));

usuariosRouter.post('/', autorizar('ADMIN', 'GERENTE'), validar({ body: criarFuncionarioSchema }), h(async (req, res) => {
  res.status(201).json(await services.usuarios.criarFuncionario(ctx(req), req.body));
}));

usuariosRouter.get('/:id', autorizar('ATENDENTE', 'GERENTE', 'ADMIN'), validar({ params: idParam }), h(async (req, res) => {
  res.json(await services.usuarios.buscarPorId(ctx(req), Number(req.params.id)));
}));
