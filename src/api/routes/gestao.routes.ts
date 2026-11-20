import { Router } from 'express';
import { services } from '../../container';
import { autenticar, autorizar, ctx, h, q, validar } from '../middlewares';
import { auditoriaQuery, maisVendidosQuery, paginacao, promocaoSchema, promocoesQuery, relatorioVendasQuery } from '../schemas';

export const fidelidadeRouter = Router();
export const promocoesRouter = Router();
export const relatoriosRouter = Router();
export const auditoriaRouter = Router();

fidelidadeRouter.use(autenticar, autorizar('CLIENTE'));
fidelidadeRouter.get('/saldo', h(async (req, res) => {
  res.json(await services.fidelidade.saldo(ctx(req)));
}));
fidelidadeRouter.get('/extrato', validar({ query: paginacao }), h(async (req, res) => {
  res.json(await services.fidelidade.extrato(ctx(req), q(req)));
}));

promocoesRouter.get('/', validar({ query: promocoesQuery }), h(async (req, res) => {
  res.json(await services.gestao.listarPromocoesVigentes(q(req)));
}));
promocoesRouter.post('/', autenticar, autorizar('ADMIN'), validar({ body: promocaoSchema }), h(async (req, res) => {
  res.status(201).json(await services.gestao.criarPromocao(ctx(req), req.body));
}));

relatoriosRouter.use(autenticar, autorizar('GERENTE', 'ADMIN'));
relatoriosRouter.get('/vendas', validar({ query: relatorioVendasQuery }), h(async (req, res) => {
  res.json(await services.gestao.relatorioVendas(ctx(req), q(req)));
}));
relatoriosRouter.get('/produtos-mais-vendidos', validar({ query: maisVendidosQuery }), h(async (req, res) => {
  res.json(await services.gestao.produtosMaisVendidos(ctx(req), q(req)));
}));

auditoriaRouter.get('/', autenticar, autorizar('ADMIN'), validar({ query: auditoriaQuery }), h(async (req, res) => {
  res.json(await services.gestao.listarAuditoria(q(req)));
}));
