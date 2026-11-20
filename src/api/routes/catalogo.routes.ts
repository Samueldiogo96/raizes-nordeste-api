import { Router } from 'express';
import { services } from '../../container';
import { autenticar, autorizar, ctx, h, q, validar } from '../middlewares';
import {
  cardapioItemParams, cardapioItemSchema, cardapioQuery, idParam, listarProdutosQuery, listarUnidadesQuery,
  movimentacaoSchema, movimentacoesQuery, produtoSchema, saldoQuery, unidadeSchema,
} from '../schemas';

export const unidadesRouter = Router();
export const produtosRouter = Router();
export const estoqueRouter = Router();

unidadesRouter.get('/', validar({ query: listarUnidadesQuery }), h(async (req, res) => {
  res.json(await services.unidades.listar(q(req)));
}));

unidadesRouter.get('/:id', validar({ params: idParam }), h(async (req, res) => {
  res.json(await services.unidades.obter(Number(req.params.id)));
}));

unidadesRouter.post('/', autenticar, autorizar('ADMIN'), validar({ body: unidadeSchema }), h(async (req, res) => {
  res.status(201).json(await services.unidades.criar(ctx(req), req.body));
}));

/** Cardápio público, sem login. */
unidadesRouter.get('/:id/cardapio', validar({ params: idParam, query: cardapioQuery }), h(async (req, res) => {
  res.json(await services.unidades.cardapio(Number(req.params.id), q(req)));
}));

unidadesRouter.put('/:id/cardapio/:produtoId', autenticar, autorizar('GERENTE', 'ADMIN'),
  validar({ params: cardapioItemParams, body: cardapioItemSchema }), h(async (req, res) => {
    res.json(await services.unidades.configurarItemCardapio(ctx(req), Number(req.params.id), Number(req.params.produtoId), req.body));
  }));

unidadesRouter.get('/:id/estoque', autenticar, autorizar('ATENDENTE', 'COZINHA', 'GERENTE', 'ADMIN'),
  validar({ params: idParam, query: saldoQuery }), h(async (req, res) => {
    res.json(await services.estoque.saldoPorUnidade(ctx(req), Number(req.params.id), q(req)));
  }));

produtosRouter.get('/', validar({ query: listarProdutosQuery }), h(async (req, res) => {
  res.json(await services.produtos.listar(q(req)));
}));

produtosRouter.get('/:id', validar({ params: idParam }), h(async (req, res) => {
  res.json(await services.produtos.obter(Number(req.params.id)));
}));

produtosRouter.post('/', autenticar, autorizar('ADMIN'), validar({ body: produtoSchema }), h(async (req, res) => {
  res.status(201).json(await services.produtos.criar(ctx(req), req.body));
}));

produtosRouter.patch('/:id', autenticar, autorizar('ADMIN'), validar({ params: idParam, body: produtoSchema.partial() }), h(async (req, res) => {
  res.json(await services.produtos.atualizar(ctx(req), Number(req.params.id), req.body));
}));

estoqueRouter.use(autenticar, autorizar('GERENTE', 'ADMIN'));

estoqueRouter.post('/movimentacoes', validar({ body: movimentacaoSchema }), h(async (req, res) => {
  res.status(201).json(await services.estoque.movimentar(ctx(req), req.body));
}));

estoqueRouter.get('/movimentacoes', validar({ query: movimentacoesQuery }), h(async (req, res) => {
  res.json(await services.estoque.listarMovimentacoes(ctx(req), q(req)));
}));
