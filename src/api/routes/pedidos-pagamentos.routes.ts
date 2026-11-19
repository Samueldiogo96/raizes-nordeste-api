import { Router } from 'express';
import { services } from '../../container';
import { Erros } from '../../domain/errors';
import { autenticar, autorizar, ctx, h, q, validar } from '../middlewares';
import { cancelarSchema, criarPedidoSchema, idParam, listarPedidosQuery, pagamentoSchema, statusSchema, webhookSchema } from '../schemas';

export const pedidosRouter = Router();
export const pagamentosRouter = Router();

const chaveIdempotencia = (valor: string | undefined) => {
  if (valor === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(valor)) {
    throw Erros.validacao('Idempotency-Key inválida.', [{ field: 'Idempotency-Key', issue: '8 a 64 caracteres: letras, números, _ ou -' }]);
  }
  return valor;
};

// ---------------------------------------------------------------- /pedidos
pedidosRouter.use(autenticar);

pedidosRouter.post('/', autorizar('CLIENTE', 'ATENDENTE', 'GERENTE', 'ADMIN'), validar({ body: criarPedidoSchema }), h(async (req, res) => {
  const r = await services.pedidos.criar(ctx(req), req.body, chaveIdempotencia(req.header('idempotency-key')));
  res.status(r.reaproveitado ? 200 : 201).location(`/pedidos/${r.pedido.pedidoId}`).json(r.pedido);
}));

/** Listagem com filtros (ex.: ?canalPedido=TOTEM&status=AGUARDANDO_PAGAMENTO&page=1&limit=10). */
pedidosRouter.get('/', validar({ query: listarPedidosQuery }), h(async (req, res) => {
  res.json(await services.pedidos.listar(ctx(req), q(req)));
}));

pedidosRouter.get('/:id', validar({ params: idParam }), h(async (req, res) => {
  res.json(await services.pedidos.obter(ctx(req), Number(req.params.id)));
}));

pedidosRouter.patch('/:id/status', autorizar('COZINHA', 'ATENDENTE', 'GERENTE', 'ADMIN'), validar({ params: idParam, body: statusSchema }), h(async (req, res) => {
  res.json(await services.pedidos.atualizarStatus(ctx(req), Number(req.params.id), req.body.status, req.body.observacao));
}));

pedidosRouter.post('/:id/cancelar', autorizar('CLIENTE', 'GERENTE', 'ADMIN'), validar({ params: idParam, body: cancelarSchema }), h(async (req, res) => {
  res.json(await services.pedidos.cancelar(ctx(req), Number(req.params.id), req.body.motivo));
}));

// ---------------------------------------------------------------- /pagamentos
/** Webhook do provedor (sem JWT; autenticado pelo header X-Webhook-Secret). */
pagamentosRouter.post('/webhook', validar({ body: webhookSchema }), h(async (req, res) => {
  res.json(await services.pagamentos.processarWebhook(req.header('x-webhook-secret'), req.body));
}));

pagamentosRouter.post('/', autenticar, autorizar('CLIENTE', 'ATENDENTE', 'GERENTE', 'ADMIN'), validar({ body: pagamentoSchema }), h(async (req, res) => {
  const r = await services.pagamentos.solicitar(ctx(req), req.body, chaveIdempotencia(req.header('idempotency-key')));
  res.status(r.http).json(r.corpo);
}));

pagamentosRouter.get('/:id', autenticar, validar({ params: idParam }), h(async (req, res) => {
  res.json(await services.pagamentos.obter(ctx(req), Number(req.params.id)));
}));
