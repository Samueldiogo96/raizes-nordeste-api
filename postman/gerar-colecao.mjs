// Gera a coleção Postman v2.1 da API Raízes do Nordeste.
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];

const tok = (v) => [{ key: 'Authorization', value: `Bearer {{${v}}}` }];
const json = [{ key: 'Content-Type', value: 'application/json' }];

function req(name, method, url, { token, body, headers = [], tests = [], pre = [], desc } = {}) {
  const h = [...(token ? tok(token) : []), ...(body ? json : []), ...headers];
  const [p, qs] = url.split('?');
  const item = {
    name,
    request: {
      method,
      header: h,
      url: {
        raw: `{{baseUrl}}${url}`,
        host: ['{{baseUrl}}'],
        path: p.split('/').filter(Boolean),
        ...(qs ? { query: qs.split('&').map((kv) => { const [key, value] = kv.split('='); return { key, value }; }) } : {}),
      },
      ...(desc ? { description: desc } : {}),
      ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2).replace(/"(\{\{pedido\w*Id\}\})"/g, '$1'), options: { raw: { language: 'json' } } } } : {}),
    },
    event: [],
  };
  if (pre.length) item.event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: pre } });
  if (tests.length) item.event.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  return item;
}

const status = (s) => `pm.test('Status ${s}', () => pm.response.to.have.status(${s}));`;
const erro = (code) => [
  `const b = pm.response.json();`,
  `pm.test('Erro padronizado: ${code}', () => { pm.expect(b.error).to.eql('${code}'); pm.expect(b).to.have.keys(['error','message','details','timestamp','path','requestId']); });`,
];
const login = (name, email, v) => req(name, 'POST', '/auth/login', {
  body: { email, senha: 'Senha@123' },
  tests: [status(200), `pm.collectionVariables.set('${v}', pm.response.json().accessToken);`],
});
const pedidoBase = { unidadeId: 1, canalPedido: 'APP', itens: [{ produtoId: 1, quantidade: 2 }, { produtoId: 6, quantidade: 2 }], formaPagamento: 'PIX' };
const criarPedidoSalvando = (name, v, itens, extra = {}) => req(name, 'POST', '/pedidos', {
  token: 'tokenCliente',
  body: { ...pedidoBase, itens, ...extra },
  tests: [status(201), `pm.collectionVariables.set('${v}', pm.response.json().pedidoId);`],
});

const colecao = {
  info: {
    name: 'Raízes do Nordeste — API (Trilha Back-end)',
    description: 'Coleção de testes da API. Antes de executar: `npm run setup` (migrations + seed) e `npm run dev`. Execute a coleção inteira em ordem (Runner ou `npm run test:postman`). Os IDs T01..T30 correspondem ao Plano de Testes do documento.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' },
    ...['tokenCliente', 'tokenJoao', 'tokenAtendente', 'tokenCozinha', 'tokenGerente', 'tokenGerenteSP', 'tokenAdmin', 'pedidoId', 'pedidoRecusadoId', 'pedidoFalhaId', 'pedidoPendenteId', 'transacaoPendente', 'idemKey'].map((key) => ({ key, value: '' })),
  ],
  item: [
    {
      name: '00 - Auth',
      item: [
        req('T01 - Login válido (cliente)', 'POST', '/auth/login', {
          body: { email: 'maria@cliente.com', senha: 'Senha@123' },
          tests: [status(200), `const b = pm.response.json();`, `pm.test('Retorna accessToken Bearer', () => { pm.expect(b.accessToken).to.be.a('string'); pm.expect(b.tokenType).to.eql('Bearer'); pm.expect(b.user.perfil).to.eql('CLIENTE'); });`, `pm.test('Não expõe hash de senha', () => pm.expect(JSON.stringify(b)).to.not.include('senha'));`, `pm.collectionVariables.set('tokenCliente', b.accessToken);`],
        }),
        login('Login - João (cliente sem fidelidade)', 'joao@cliente.com', 'tokenJoao'),
        login('Login - Atendente Recife', 'atendente.recife@raizes.com', 'tokenAtendente'),
        login('Login - Cozinha Recife', 'cozinha.recife@raizes.com', 'tokenCozinha'),
        login('Login - Gerente Recife', 'gerente.recife@raizes.com', 'tokenGerente'),
        login('Login - Gerente São Paulo', 'gerente.sp@raizes.com', 'tokenGerenteSP'),
        login('Login - Admin (matriz)', 'admin@raizes.com', 'tokenAdmin'),
        req('T02 - Login com senha inválida (401)', 'POST', '/auth/login', { body: { email: 'maria@cliente.com', senha: 'senhaErrada1' }, tests: [status(401), ...erro('CREDENCIAIS_INVALIDAS')] }),
        req('Registrar cliente com consentimento (201)', 'POST', '/auth/registrar', {
          body: { nome: 'Ana Souza', email: 'ana.{{$timestamp}}@exemplo.com', senha: 'Senha@123', consentimentoFidelidade: true, consentimentoMarketing: false, canal: 'APP' },
          tests: [status(201), `pm.test('Consentimento registrado', () => pm.expect(pm.response.json().consentimentos.FIDELIDADE).to.eql(true));`],
        }),
        req('T16 - Registrar com e-mail inválido (422)', 'POST', '/auth/registrar', {
          body: { nome: 'Ana', email: 'ana-sem-arroba', senha: 'Senha@123', consentimentoFidelidade: true },
          tests: [status(422), ...erro('VALIDACAO_FALHOU'), `pm.test('Aponta o campo email', () => pm.expect(b.details[0].field).to.eql('email'));`],
        }),
      ],
    },
    {
      name: '01 - Catálogo e Cardápio',
      item: [
        req('Listar unidades (paginado)', 'GET', '/unidades?page=1&limit=10', { tests: [status(200), `pm.test('Tem meta de paginação', () => pm.expect(pm.response.json().meta.total).to.be.above(0));`] }),
        req('T06 - Cardápio unidade 2 (cozinha reduzida, preço regional)', 'GET', '/unidades/2/cardapio?incluirIndisponiveis=true', {
          tests: [status(200), `const itens = pm.response.json().itens;`, `pm.test('Cuscuz indisponível em cozinha reduzida', () => pm.expect(itens.find(i => i.produtoId === 3).disponivel).to.eql(false));`, `pm.test('Preço regional aplicado', () => pm.expect(itens.find(i => i.produtoId === 1).preco).to.eql(21.74));`],
        }),
        req('Listar produtos', 'GET', '/produtos?page=1&limit=5', { tests: [status(200)] }),
        req('Promoções vigentes no canal APP', 'GET', '/promocoes?canalPedido=APP', { tests: [status(200)] }),
      ],
    },
    {
      name: '02 - Pedidos (fluxo principal)',
      item: [
        req('T07 - Criar pedido APP válido (201)', 'POST', '/pedidos', {
          token: 'tokenCliente', body: pedidoBase,
          tests: [status(201), `const b = pm.response.json();`, `pm.test('AGUARDANDO_PAGAMENTO e canal APP', () => { pm.expect(b.status).to.eql('AGUARDANDO_PAGAMENTO'); pm.expect(b.canalPedido).to.eql('APP'); pm.expect(b.total).to.eql(47.8); });`, `pm.collectionVariables.set('pedidoId', b.pedidoId);`],
        }),
        req('Consultar pedido criado', 'GET', '/pedidos/{{pedidoId}}', { token: 'tokenCliente', tests: [status(200)] }),
        req('T13a - Criar pedido com Idempotency-Key (201)', 'POST', '/pedidos', {
          token: 'tokenCliente', body: { ...pedidoBase, itens: [{ produtoId: 6, quantidade: 1 }] }, headers: [{ key: 'Idempotency-Key', value: '{{idemKey}}' }],
          pre: [`pm.collectionVariables.set('idemKey', 'postman-' + Date.now());`],
          tests: [status(201), `pm.collectionVariables.set('idemPedido', pm.response.json().pedidoId);`],
        }),
        req('T13b - Reenviar mesma Idempotency-Key (200, mesmo pedido)', 'POST', '/pedidos', {
          token: 'tokenCliente', body: { ...pedidoBase, itens: [{ produtoId: 6, quantidade: 1 }] }, headers: [{ key: 'Idempotency-Key', value: '{{idemKey}}' }],
          tests: [status(200), `pm.test('Mesmo pedidoId (sem duplicar)', () => pm.expect(pm.response.json().pedidoId).to.eql(Number(pm.collectionVariables.get('idemPedido'))));`],
        }),
        req('Criar pedido com promoção APP5 + resgate de 100 pontos', 'POST', '/pedidos', {
          token: 'tokenCliente', body: { ...pedidoBase, codigoPromocao: 'APP5', pontosResgatar: 100 },
          tests: [status(201), `pm.test('Desconto = R$5 promo + R$5 pontos', () => pm.expect(pm.response.json().desconto).to.eql(10));`],
        }),
      ],
    },
    {
      name: '03 - Pagamento mock e Status',
      item: [
        req('T08 - Pagamento APROVADO → pedido PAGO (201)', 'POST', '/pagamentos', {
          token: 'tokenCliente', body: { pedidoId: '{{pedidoId}}', tokenPagamento: 'tok_aprovado' },
          tests: [status(201), `const b = pm.response.json();`, `pm.test('Aprovado e pedido PAGO', () => { pm.expect(b.status).to.eql('APROVADO'); pm.expect(b.statusPedido).to.eql('PAGO'); });`, `pm.test('Pontos creditados', () => pm.expect(b.pontosGanhos).to.be.above(0));`],
        }),
        req('T09a - Cozinha: PAGO → EM_PREPARO', 'PATCH', '/pedidos/{{pedidoId}}/status', { token: 'tokenCozinha', body: { status: 'EM_PREPARO' }, tests: [status(200), `pm.test('EM_PREPARO', () => pm.expect(pm.response.json().status).to.eql('EM_PREPARO'));`] }),
        req('T09b - Cozinha: EM_PREPARO → PRONTO', 'PATCH', '/pedidos/{{pedidoId}}/status', { token: 'tokenCozinha', body: { status: 'PRONTO' }, tests: [status(200)] }),
        req('T09c - Atendente: PRONTO → ENTREGUE', 'PATCH', '/pedidos/{{pedidoId}}/status', {
          token: 'tokenAtendente', body: { status: 'ENTREGUE' },
          tests: [status(200), `pm.test('Histórico completo', () => pm.expect(pm.response.json().historicoStatus.map(h => h.para)).to.eql(['AGUARDANDO_PAGAMENTO','PAGO','EM_PREPARO','PRONTO','ENTREGUE']));`],
        }),
        criarPedidoSalvando('T10a - Criar pedido para pagamento recusado', 'pedidoRecusadoId', [{ produtoId: 2, quantidade: 1 }], { formaPagamento: 'CARTAO_CREDITO' }),
        req('T10b - Pagamento RECUSADO → PAGAMENTO_RECUSADO (201)', 'POST', '/pagamentos', {
          token: 'tokenCliente', body: { pedidoId: '{{pedidoRecusadoId}}', tokenPagamento: 'tok_recusado' },
          tests: [status(201), `const b = pm.response.json();`, `pm.test('Recusado com mensagem coerente', () => { pm.expect(b.status).to.eql('RECUSADO'); pm.expect(b.statusPedido).to.eql('PAGAMENTO_RECUSADO'); pm.expect(b.mensagem).to.include('recusado'); });`],
        }),
        req('T10c - Nova tentativa APROVADA → PAGO', 'POST', '/pagamentos', { token: 'tokenCliente', body: { pedidoId: '{{pedidoRecusadoId}}', tokenPagamento: 'tok_aprovado' }, tests: [status(201), `pm.test('PAGO', () => pm.expect(pm.response.json().statusPedido).to.eql('PAGO'));`] }),
        criarPedidoSalvando('T11a - Criar pedido para falha do gateway', 'pedidoFalhaId', [{ produtoId: 4, quantidade: 1 }]),
        req('T11b - Gateway indisponível (502, nada cobrado)', 'POST', '/pagamentos', { token: 'tokenCliente', body: { pedidoId: '{{pedidoFalhaId}}', tokenPagamento: 'tok_falha_gateway' }, tests: [status(502), ...erro('GATEWAY_PAGAMENTO_INDISPONIVEL')] }),
        req('T11c - Pedido continua AGUARDANDO_PAGAMENTO', 'GET', '/pedidos/{{pedidoFalhaId}}', { token: 'tokenCliente', tests: [status(200), `pm.test('Status preservado', () => pm.expect(pm.response.json().status).to.eql('AGUARDANDO_PAGAMENTO'));`] }),
        criarPedidoSalvando('T12a - Criar pedido para pagamento PIX pendente', 'pedidoPendenteId', [{ produtoId: 10, quantidade: 1 }]),
        req('T12b - Pagamento PENDENTE (202)', 'POST', '/pagamentos', { token: 'tokenCliente', body: { pedidoId: '{{pedidoPendenteId}}', tokenPagamento: 'tok_pendente' }, tests: [status(202), `pm.collectionVariables.set('transacaoPendente', pm.response.json().transacaoExternaId);`] }),
        req('T12c - Webhook do provedor confirma (200)', 'POST', '/pagamentos/webhook', {
          body: { transacaoId: '{{transacaoPendente}}', status: 'APROVADO' }, headers: [{ key: 'X-Webhook-Secret', value: '{{webhookSecret}}' }],
          tests: [status(200), `pm.test('Processado', () => pm.expect(pm.response.json().processado).to.eql(true));`],
        }),
        req('T12d - Pedido ficou PAGO após webhook', 'GET', '/pedidos/{{pedidoPendenteId}}', { token: 'tokenCliente', tests: [status(200), `pm.test('PAGO', () => pm.expect(pm.response.json().status).to.eql('PAGO'));`] }),
      ],
    },
    {
      name: '04 - Erros e regras de negócio',
      item: [
        req('T03 - Listar pedidos sem token (401)', 'GET', '/pedidos', { tests: [status(401), ...erro('NAO_AUTENTICADO')] }),
        req('T04 - Cliente tenta criar produto (403)', 'POST', '/produtos', { token: 'tokenCliente', body: { nome: 'Tapioca Teste', categoria: 'TAPIOCA', precoBase: 10 }, tests: [status(403), ...erro('ACESSO_NEGADO')] }),
        req('T05 - Gerente SP consulta estoque de Recife (403)', 'GET', '/unidades/1/estoque', { token: 'tokenGerenteSP', tests: [status(403), ...erro('ACESSO_NEGADO')] }),
        req('T14 - Pedido sem canalPedido (422)', 'POST', '/pedidos', {
          token: 'tokenCliente', body: { unidadeId: 1, itens: [{ produtoId: 1, quantidade: 1 }], formaPagamento: 'PIX' },
          tests: [status(422), ...erro('VALIDACAO_FALHOU'), `pm.test('Campo canalPedido', () => pm.expect(b.details[0].field).to.eql('canalPedido'));`],
        }),
        req('T15 - Canal inválido e quantidade negativa (422)', 'POST', '/pedidos', {
          token: 'tokenCliente', body: { ...pedidoBase, canalPedido: 'FAX', itens: [{ produtoId: 1, quantidade: -2 }] },
          tests: [status(422), ...erro('VALIDACAO_FALHOU'), `pm.test('Aponta os dois campos', () => { const f = b.details.map(d => d.field); pm.expect(f).to.include('canalPedido'); pm.expect(f).to.include('itens[0].quantidade'); });`],
        }),
        req('T17 - Produto inexistente (404)', 'POST', '/pedidos', { token: 'tokenCliente', body: { ...pedidoBase, itens: [{ produtoId: 999, quantidade: 1 }] }, tests: [status(404), ...erro('PRODUTO_NAO_ENCONTRADO')] }),
        req('T18 - Unidade inexistente (404)', 'POST', '/pedidos', { token: 'tokenCliente', body: { ...pedidoBase, unidadeId: 99 }, tests: [status(404), ...erro('UNIDADE_NAO_ENCONTRADO')] }),
        req('T19 - Estoque insuficiente (409)', 'POST', '/pedidos', {
          token: 'tokenCliente', body: { ...pedidoBase, itens: [{ produtoId: 5, quantidade: 10 }] },
          tests: [status(409), ...erro('ESTOQUE_INSUFICIENTE'), `pm.test('Informa o disponível', () => pm.expect(b.details[0].issue).to.include('disponível'));`],
        }),
        req('T20 - Transição de status inválida (409)', 'PATCH', '/pedidos/{{pedidoFalhaId}}/status', { token: 'tokenCozinha', body: { status: 'EM_PREPARO' }, tests: [status(409), ...erro('TRANSICAO_STATUS_INVALIDA')] }),
        req('T21 - Cuscuz em unidade de cozinha reduzida (409)', 'POST', '/pedidos', { token: 'tokenCliente', body: { ...pedidoBase, unidadeId: 2, itens: [{ produtoId: 3, quantidade: 1 }] }, tests: [status(409), ...erro('PRODUTO_INDISPONIVEL')] }),
        req('T22 - Resgate de pontos sem consentimento (409)', 'POST', '/pedidos', { token: 'tokenJoao', body: { ...pedidoBase, pontosResgatar: 10 }, tests: [status(409), ...erro('CONSENTIMENTO_NECESSARIO')] }),
        req('T23 - Cliente consulta pedido de outro cliente (404)', 'GET', '/pedidos/{{pedidoId}}', { token: 'tokenJoao', tests: [status(404), ...erro('PEDIDO_NAO_ENCONTRADO')] }),
      ],
    },
    {
      name: '05 - Multicanal, LGPD, Auditoria e Gestão',
      item: [
        req('Atendente registra pedido de BALCÃO', 'POST', '/pedidos', { token: 'tokenAtendente', body: { unidadeId: 1, canalPedido: 'BALCAO', clienteId: 6, itens: [{ produtoId: 10, quantidade: 2 }], formaPagamento: 'DINHEIRO' }, tests: [status(201)] }),
        req('T24 - Filtrar pedidos por canal (?canalPedido=BALCAO)', 'GET', '/pedidos?canalPedido=BALCAO&page=1&limit=10', {
          token: 'tokenAdmin',
          tests: [status(200), `const b = pm.response.json();`, `pm.test('Todos do canal BALCAO', () => { pm.expect(b.data.length).to.be.above(0); b.data.forEach(p => pm.expect(p.canalPedido).to.eql('BALCAO')); });`],
        }),
        req('T25a - Cliente cancela pedido não pago', 'POST', '/pedidos/{{pedidoFalhaId}}/cancelar', { token: 'tokenCliente', body: { motivo: 'Desisti da compra' }, tests: [status(200), `pm.test('CANCELADO', () => pm.expect(pm.response.json().status).to.eql('CANCELADO'));`] }),
        req('T25b - Auditoria registrou PEDIDO_CANCELADO', 'GET', '/auditoria?acao=PEDIDO_CANCELADO&entidadeId={{pedidoFalhaId}}', {
          token: 'tokenAdmin',
          tests: [status(200), `pm.test('Log de auditoria gerado', () => { const d = pm.response.json().data; pm.expect(d.length).to.eql(1); pm.expect(d[0].perfil).to.eql('CLIENTE'); });`],
        }),
        req('Auditoria de criação de pedidos (PEDIDO_CRIADO)', 'GET', '/auditoria?acao=PEDIDO_CRIADO&limit=5', { token: 'tokenAdmin', tests: [status(200)] }),
        req('T26 - Atendente consulta cliente (dados mascarados + log)', 'GET', '/usuarios/6', {
          token: 'tokenAtendente',
          tests: [status(200), `pm.test('E-mail e telefone mascarados', () => { const b = pm.response.json(); pm.expect(b.email).to.eql('ma***@cliente.com'); pm.expect(b.telefone).to.eql('*******1234'); });`],
        }),
        req('T27 - Exportar meus dados (portabilidade LGPD)', 'GET', '/usuarios/me/exportar', { token: 'tokenCliente', tests: [status(200), `pm.test('Sem hash de senha', () => pm.expect(pm.response.text()).to.not.include('senhaHash'));`] }),
        req('Conceder consentimento FIDELIDADE (João)', 'POST', '/usuarios/me/consentimentos', { token: 'tokenJoao', body: { finalidade: 'FIDELIDADE', concedido: true, canal: 'APP' }, tests: [status(200)] }),
        req('T28 - Saldo de pontos de fidelidade', 'GET', '/fidelidade/saldo', { token: 'tokenCliente', tests: [status(200), `pm.test('Saldo > 0', () => pm.expect(pm.response.json().saldoPontos).to.be.above(0));`] }),
        req('Extrato de pontos', 'GET', '/fidelidade/extrato', { token: 'tokenCliente', tests: [status(200)] }),
        req('T29 - Gerente registra ENTRADA de estoque (201)', 'POST', '/estoque/movimentacoes', {
          token: 'tokenGerente', body: { unidadeId: 1, produtoId: 5, tipo: 'ENTRADA', quantidade: 20, motivo: 'Recebimento do fornecedor' },
          tests: [status(201), `pm.test('Saldo atualizado', () => { const b = pm.response.json(); pm.expect(b.saldoAtual).to.eql(b.saldoAnterior + 20); });`],
        }),
        req('Saldo de estoque da unidade 1', 'GET', '/unidades/1/estoque', { token: 'tokenGerente', tests: [status(200)] }),
        req('T30 - Relatório de vendas por canal (matriz)', 'GET', '/relatorios/vendas?agruparPor=canal', { token: 'tokenAdmin', tests: [status(200), `pm.test('Consolida por canal', () => pm.expect(pm.response.json().linhas.length).to.be.above(2));`] }),
        req('Produtos mais vendidos (gerente)', 'GET', '/relatorios/produtos-mais-vendidos?limite=5', { token: 'tokenGerente', tests: [status(200)] }),
        req('Health check', 'GET', '/health', { tests: [status(200)] }),
      ],
    },
  ],
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(path.join(out, 'raizes-nordeste.postman_collection.json'), JSON.stringify(colecao, null, 2));
fs.writeFileSync(path.join(out, 'local.postman_environment.json'), JSON.stringify({
  name: 'Raízes do Nordeste - Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:3000', enabled: true },
    { key: 'webhookSecret', value: 'segredo-webhook-mock', enabled: true },
  ],
}, null, 2));
const total = colecao.item.reduce((a, f) => a + f.item.length, 0);
console.log(`Coleção gerada com ${total} requisições.`);
