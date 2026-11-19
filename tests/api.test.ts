/**
 * Testes de INTEGRAÇÃO da API (HTTP → aplicação → banco SQLite de teste).
 * Banco isolado: prisma/test.db, recriado (migrations + seed) antes da suíte.
 * Os IDs (T01, T02...) correspondem ao Plano de Testes do documento e à coleção Postman.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET ??= 'segredo-de-teste';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'segredo-webhook-mock';
process.env.PAYMENT_TIMEOUT_MS = '500';

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
const tokens: Record<string, string> = {};

async function login(email: string) {
  const r = await request(app).post('/auth/login').send({ email, senha: 'Senha@123' });
  assert.equal(r.status, 200, `login de ${email} falhou: ${JSON.stringify(r.body)}`);
  return r.body.accessToken as string;
}
const auth = (perfil: string) => ({ Authorization: `Bearer ${tokens[perfil]}` });

/** Garante que o corpo segue o padrão único de erro do contrato. */
function assertErroPadrao(body: Record<string, unknown>, codigo: string) {
  assert.equal(body.error, codigo);
  assert.equal(typeof body.message, 'string');
  assert.ok(Array.isArray(body.details));
  assert.ok(body.timestamp && body.path && body.requestId);
}

before(async () => {
  const db = path.join(__dirname, '..', 'prisma', 'test.db');
  if (fs.existsSync(db)) fs.rmSync(db);
  const env = { ...process.env, DATABASE_URL: 'file:./test.db' };
  execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
  execSync('npx prisma db seed', { env, stdio: 'ignore' });
  app = (await import('../src/api/app')).criarApp();
  tokens.cliente = await login('maria@cliente.com');
  tokens.joao = await login('joao@cliente.com');
  tokens.atendente = await login('atendente.recife@raizes.com');
  tokens.cozinha = await login('cozinha.recife@raizes.com');
  tokens.gerenteSP = await login('gerente.sp@raizes.com');
  tokens.admin = await login('admin@raizes.com');
});

after(async () => {
  const { prisma } = await import('../src/infrastructure/database/prisma');
  await prisma.$disconnect();
});

const pedidoValido = { unidadeId: 1, canalPedido: 'APP', itens: [{ produtoId: 1, quantidade: 2 }, { produtoId: 6, quantidade: 2 }], formaPagamento: 'PIX' };

describe('Autenticação e autorização', () => {
  it('T01 login válido retorna token JWT', async () => {
    const r = await request(app).post('/auth/login').send({ email: 'maria@cliente.com', senha: 'Senha@123' });
    assert.equal(r.status, 200);
    assert.ok(r.body.accessToken);
    assert.equal(r.body.tokenType, 'Bearer');
    assert.equal(r.body.user.perfil, 'CLIENTE');
    assert.equal(r.body.user.senhaHash, undefined);
  });
  it('T02 login com senha errada → 401 CREDENCIAIS_INVALIDAS', async () => {
    const r = await request(app).post('/auth/login').send({ email: 'maria@cliente.com', senha: 'errada123' });
    assert.equal(r.status, 401);
    assertErroPadrao(r.body, 'CREDENCIAIS_INVALIDAS');
  });
  it('T03 acesso sem token → 401', async () => {
    const r = await request(app).get('/pedidos');
    assert.equal(r.status, 401);
    assertErroPadrao(r.body, 'NAO_AUTENTICADO');
  });
  it('T04 perfil sem permissão (CLIENTE criando produto) → 403', async () => {
    const r = await request(app).post('/produtos').set(auth('cliente')).send({ nome: 'X', categoria: 'BOLO', precoBase: 1 });
    assert.equal(r.status, 403);
    assertErroPadrao(r.body, 'ACESSO_NEGADO');
  });
  it('T05 gerente de outra unidade não vê estoque da unidade 1 → 403', async () => {
    const r = await request(app).get('/unidades/1/estoque').set(auth('gerenteSP'));
    assert.equal(r.status, 403);
  });
});

describe('Cardápio por unidade', () => {
  it('T06 cardápio da unidade com cozinha reduzida marca cuscuz como indisponível', async () => {
    const r = await request(app).get('/unidades/2/cardapio?incluirIndisponiveis=true');
    assert.equal(r.status, 200);
    const cuscuz = r.body.itens.find((i: { produtoId: number }) => i.produtoId === 3);
    assert.equal(cuscuz.disponivel, false);
    const tapioca = r.body.itens.find((i: { produtoId: number }) => i.produtoId === 1);
    assert.equal(tapioca.preco, 21.74); // preço regional (+15%)
  });
});

describe('Pedido → Pagamento mock → Status (fluxo crítico)', () => {
  let pedidoId: number;

  it('T07 pedido com itens válidos → 201 AGUARDANDO_PAGAMENTO com canalPedido', async () => {
    const r = await request(app).post('/pedidos').set(auth('cliente')).send(pedidoValido);
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(r.body.canalPedido, 'APP');
    assert.equal(r.body.total, 47.8);
    pedidoId = r.body.pedidoId;
  });

  it('T08 pagamento mock APROVADO → pedido PAGO + pontos creditados', async () => {
    const r = await request(app).post('/pagamentos').set(auth('cliente')).send({ pedidoId, tokenPagamento: 'tok_aprovado' });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'APROVADO');
    assert.equal(r.body.statusPedido, 'PAGO');
    assert.equal(r.body.pontosGanhos, 47);
  });

  it('T09 cozinha → EM_PREPARO → PRONTO; atendente → ENTREGUE', async () => {
    let r = await request(app).patch(`/pedidos/${pedidoId}/status`).set(auth('cozinha')).send({ status: 'EM_PREPARO' });
    assert.equal(r.status, 200);
    r = await request(app).patch(`/pedidos/${pedidoId}/status`).set(auth('cozinha')).send({ status: 'PRONTO' });
    assert.equal(r.body.status, 'PRONTO');
    r = await request(app).patch(`/pedidos/${pedidoId}/status`).set(auth('atendente')).send({ status: 'ENTREGUE' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ENTREGUE');
    assert.deepEqual(r.body.historicoStatus.map((h: { para: string }) => h.para), ['AGUARDANDO_PAGAMENTO', 'PAGO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE']);
  });

  it('T10 pagamento mock RECUSADO → PAGAMENTO_RECUSADO; nova tentativa aprovada → PAGO', async () => {
    const p = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 2, quantidade: 1 }] });
    let r = await request(app).post('/pagamentos').set(auth('cliente')).send({ pedidoId: p.body.pedidoId, tokenPagamento: 'tok_recusado' });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'RECUSADO');
    assert.equal(r.body.statusPedido, 'PAGAMENTO_RECUSADO');
    assert.match(r.body.mensagem, /recusado/i);
    r = await request(app).post('/pagamentos').set(auth('cliente')).send({ pedidoId: p.body.pedidoId, tokenPagamento: 'tok_aprovado' });
    assert.equal(r.body.statusPedido, 'PAGO');
  });

  it('T11 gateway indisponível → 502 e pedido continua AGUARDANDO_PAGAMENTO', async () => {
    const p = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 4, quantidade: 1 }] });
    const r = await request(app).post('/pagamentos').set(auth('cliente')).send({ pedidoId: p.body.pedidoId, tokenPagamento: 'tok_falha_gateway' });
    assert.equal(r.status, 502);
    assertErroPadrao(r.body, 'GATEWAY_PAGAMENTO_INDISPONIVEL');
    const g = await request(app).get(`/pedidos/${p.body.pedidoId}`).set(auth('cliente'));
    assert.equal(g.body.status, 'AGUARDANDO_PAGAMENTO');
  });

  it('T12 pagamento PENDENTE confirmado via webhook (idempotente)', async () => {
    const p = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 10, quantidade: 1 }] });
    const r = await request(app).post('/pagamentos').set(auth('cliente')).send({ pedidoId: p.body.pedidoId, tokenPagamento: 'tok_pendente' });
    assert.equal(r.status, 202);
    const evento = { transacaoId: r.body.transacaoExternaId, status: 'APROVADO' };
    const semSegredo = await request(app).post('/pagamentos/webhook').send(evento);
    assert.equal(semSegredo.status, 401);
    const w = await request(app).post('/pagamentos/webhook').set('X-Webhook-Secret', 'segredo-webhook-mock').send(evento);
    assert.equal(w.body.processado, true);
    const repetido = await request(app).post('/pagamentos/webhook').set('X-Webhook-Secret', 'segredo-webhook-mock').send(evento);
    assert.equal(repetido.body.processado, false);
    const g = await request(app).get(`/pedidos/${p.body.pedidoId}`).set(auth('cliente'));
    assert.equal(g.body.status, 'PAGO');
  });

  it('T13 Idempotency-Key repetida não duplica o pedido', async () => {
    const chave = 'teste-idem-0001';
    const r1 = await request(app).post('/pedidos').set(auth('cliente')).set('Idempotency-Key', chave).send(pedidoValido);
    const r2 = await request(app).post('/pedidos').set(auth('cliente')).set('Idempotency-Key', chave).send(pedidoValido);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 200);
    assert.equal(r1.body.pedidoId, r2.body.pedidoId);
  });
});

describe('Validações e regras de negócio (cenários negativos)', () => {
  it('T14 pedido sem canalPedido → 422', async () => {
    const { canalPedido: _c, ...semCanal } = pedidoValido;
    const r = await request(app).post('/pedidos').set(auth('cliente')).send(semCanal);
    assert.equal(r.status, 422);
    assertErroPadrao(r.body, 'VALIDACAO_FALHOU');
    assert.equal(r.body.details[0].field, 'canalPedido');
  });
  it('T15 canalPedido inválido e quantidade negativa → 422', async () => {
    const r = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, canalPedido: 'FAX', itens: [{ produtoId: 1, quantidade: -2 }] });
    assert.equal(r.status, 422);
    const campos = r.body.details.map((d: { field: string }) => d.field);
    assert.ok(campos.includes('canalPedido') && campos.includes('itens[0].quantidade'));
  });
  it('T16 cadastro com e-mail inválido → 422', async () => {
    const r = await request(app).post('/auth/registrar').send({ nome: 'Ana', email: 'ana-sem-arroba', senha: 'Senha@123', consentimentoFidelidade: true });
    assert.equal(r.status, 422);
    assert.equal(r.body.details[0].field, 'email');
  });
  it('T17 produto inexistente → 404', async () => {
    const r = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 999, quantidade: 1 }] });
    assert.equal(r.status, 404);
    assertErroPadrao(r.body, 'PRODUTO_NAO_ENCONTRADO');
  });
  it('T18 unidade inexistente → 404', async () => {
    const r = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, unidadeId: 99 });
    assert.equal(r.status, 404);
    assertErroPadrao(r.body, 'UNIDADE_NAO_ENCONTRADO');
  });
  it('T19 estoque insuficiente → 409 e nada é gravado', async () => {
    const antes = await request(app).get('/unidades/1/estoque').set(auth('atendente'));
    const r = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 1, quantidade: 1 }, { produtoId: 5, quantidade: 10 }] });
    assert.equal(r.status, 409);
    assertErroPadrao(r.body, 'ESTOQUE_INSUFICIENTE');
    const depois = await request(app).get('/unidades/1/estoque').set(auth('atendente'));
    assert.deepEqual(depois.body.itens, antes.body.itens); // rollback: a tapioca não foi baixada
  });
  it('T20 transição de status inválida → 409', async () => {
    const p = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 6, quantidade: 1 }] });
    const r = await request(app).patch(`/pedidos/${p.body.pedidoId}/status`).set(auth('cozinha')).send({ status: 'EM_PREPARO' });
    assert.equal(r.status, 409);
    assertErroPadrao(r.body, 'TRANSICAO_STATUS_INVALIDA');
  });
  it('T21 cozinha de reduzida: cuscuz na unidade 2 → 409 PRODUTO_INDISPONIVEL', async () => {
    const r = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, unidadeId: 2, itens: [{ produtoId: 3, quantidade: 1 }] });
    assert.equal(r.status, 409);
    assertErroPadrao(r.body, 'PRODUTO_INDISPONIVEL');
  });
  it('T22 resgate de pontos sem consentimento → 409 CONSENTIMENTO_NECESSARIO', async () => {
    const r = await request(app).post('/pedidos').set(auth('joao')).send({ ...pedidoValido, pontosResgatar: 10 });
    assert.equal(r.status, 409);
    assertErroPadrao(r.body, 'CONSENTIMENTO_NECESSARIO');
  });
  it('T23 cliente não vê pedido de outro cliente → 404', async () => {
    const p = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 6, quantidade: 1 }] });
    const r = await request(app).get(`/pedidos/${p.body.pedidoId}`).set(auth('joao'));
    assert.equal(r.status, 404);
  });
});

describe('Multicanalidade, cancelamento, LGPD e auditoria', () => {
  it('T24 filtrar pedidos por canal (?canalPedido=BALCAO)', async () => {
    await request(app).post('/pedidos').set(auth('atendente')).send({ unidadeId: 1, canalPedido: 'BALCAO', itens: [{ produtoId: 10, quantidade: 2 }], formaPagamento: 'DINHEIRO' });
    const r = await request(app).get('/pedidos?canalPedido=BALCAO').set(auth('admin'));
    assert.equal(r.status, 200);
    assert.ok(r.body.data.length >= 1);
    assert.ok(r.body.data.every((p: { canalPedido: string }) => p.canalPedido === 'BALCAO'));
    assert.ok(r.body.meta.total >= 1);
  });
  it('T25 cancelamento devolve estoque e gera auditoria PEDIDO_CANCELADO', async () => {
    const est = async () => (await request(app).get('/unidades/1/estoque').set(auth('atendente'))).body.itens.find((i: { produtoId: number }) => i.produtoId === 4).quantidade;
    const antes = await est();
    const p = await request(app).post('/pedidos').set(auth('cliente')).send({ ...pedidoValido, itens: [{ produtoId: 4, quantidade: 3 }] });
    assert.equal(await est(), antes - 3);
    const c = await request(app).post(`/pedidos/${p.body.pedidoId}/cancelar`).set(auth('cliente')).send({ motivo: 'Desisti da compra' });
    assert.equal(c.status, 200);
    assert.equal(c.body.status, 'CANCELADO');
    assert.equal(await est(), antes);
    const a = await request(app).get(`/auditoria?acao=PEDIDO_CANCELADO&entidadeId=${p.body.pedidoId}`).set(auth('admin'));
    assert.equal(a.body.data.length, 1);
    assert.equal(a.body.data[0].usuarioId, 6);
  });
  it('T26 atendente consulta cliente: dados mascarados + log ACESSO_DADOS_PESSOAIS', async () => {
    const r = await request(app).get('/usuarios/6').set(auth('atendente'));
    assert.equal(r.status, 200);
    assert.equal(r.body.email, 'ma***@cliente.com');
    assert.equal(r.body.telefone, '*******1234');
    const a = await request(app).get('/auditoria?acao=ACESSO_DADOS_PESSOAIS&entidadeId=6').set(auth('admin'));
    assert.ok(a.body.data.length >= 1);
  });
  it('T27 respostas nunca expõem hash de senha', async () => {
    const r = await request(app).get('/usuarios/me/exportar').set(auth('cliente'));
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.body).includes('senhaHash'));
  });
  it('T28 saldo de fidelidade reflete os pontos ganhos', async () => {
    const r = await request(app).get('/fidelidade/saldo').set(auth('cliente'));
    assert.equal(r.status, 200);
    assert.ok(r.body.saldoPontos > 500);
  });
  it('T29 gerente movimenta estoque (entrada) da própria unidade', async () => {
    const tokenGerente = await login('gerente.recife@raizes.com');
    const r = await request(app).post('/estoque/movimentacoes').set({ Authorization: `Bearer ${tokenGerente}` }).send({ unidadeId: 1, produtoId: 5, tipo: 'ENTRADA', quantidade: 20, motivo: 'Fornecedor' });
    assert.equal(r.status, 201);
    assert.equal(r.body.saldoAtual, r.body.saldoAnterior + 20);
  });
  it('T30 relatório de vendas por canal (matriz)', async () => {
    const r = await request(app).get('/relatorios/vendas?agruparPor=canal').set(auth('admin'));
    assert.equal(r.status, 200);
    assert.ok(r.body.linhas.length >= 3);
  });
});
