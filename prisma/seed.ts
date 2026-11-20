/**
 * Dados de demonstração usados pela coleção Postman e pelos testes.
 * Todos os usuários usam a senha: Senha@123
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SENHA = 'Senha@123';

async function limpar() {
  // Apaga na ordem das chaves estrangeiras.
  await prisma.auditLog.deleteMany();
  await prisma.transacaoPontos.deleteMany();
  await prisma.contaFidelidade.deleteMany();
  await prisma.movimentacaoEstoque.deleteMany();
  await prisma.pagamento.deleteMany();
  await prisma.historicoStatusPedido.deleteMany();
  await prisma.itemPedido.deleteMany();
  await prisma.pedido.deleteMany();
  await prisma.promocao.deleteMany();
  await prisma.consentimento.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.estoque.deleteMany();
  await prisma.cardapioItem.deleteMany();
  await prisma.produto.deleteMany();
  await prisma.unidade.deleteMany();
}

async function main() {
  await limpar();
  const ano = new Date().getFullYear();

  // Unidades
  const recife = await prisma.unidade.create({ data: { id: 1, nome: 'Raízes Recife - Boa Viagem', cidade: 'Recife', uf: 'PE', regiao: 'NORDESTE', tipoCozinha: 'COMPLETA' } });
  const sp = await prisma.unidade.create({ data: { id: 2, nome: 'Raízes São Paulo - Paulista', cidade: 'São Paulo', uf: 'SP', regiao: 'SUDESTE', tipoCozinha: 'REDUZIDA' } });
  const caruaru = await prisma.unidade.create({ data: { id: 3, nome: 'Raízes Caruaru - Centro', cidade: 'Caruaru', uf: 'PE', regiao: 'NORDESTE', tipoCozinha: 'COMPLETA' } });

  // Produtos
  const produtos = [
    { id: 1, nome: 'Tapioca de Carne de Sol com Queijo Coalho', categoria: 'TAPIOCA', precoBase: 18.9, descricao: 'Goma fresca, carne de sol desfiada e queijo coalho.' },
    { id: 2, nome: 'Tapioca de Coco com Leite Condensado', categoria: 'TAPIOCA', precoBase: 14.5 },
    { id: 3, nome: 'Cuscuz Recheado com Charque', categoria: 'CUSCUZ', precoBase: 22.0, exigeCozinhaCompleta: true },
    { id: 4, nome: 'Bolo de Macaxeira (fatia)', categoria: 'BOLO', precoBase: 9.0 },
    { id: 5, nome: 'Suco de Cajá 400ml', categoria: 'BEBIDA', precoBase: 8.5 },
    { id: 6, nome: 'Café Coado na Hora', categoria: 'BEBIDA', precoBase: 5.0 },
    { id: 7, nome: 'Café da Manhã Sertanejo', categoria: 'CAFE_DA_MANHA', precoBase: 34.9, exigeCozinhaCompleta: true, descricao: 'Cuscuz, ovo, queijo coalho, macaxeira e café.' },
    { id: 8, nome: 'Pamonha (Especial São João)', categoria: 'SALGADO', precoBase: 10.0, sazonal: true },
    { id: 9, nome: 'Canjica (Especial São João)', categoria: 'BOLO', precoBase: 9.5, sazonal: true },
    { id: 10, nome: 'Coxinha de Charque', categoria: 'SALGADO', precoBase: 7.5 },
  ];
  for (const p of produtos) await prisma.produto.create({ data: p });

  // Cardápio e estoque por unidade
  const janelaJunina = { disponivelDe: new Date(`${ano}-06-01T00:00:00-03:00`), disponivelAte: new Date(`${ano}-07-31T23:59:59-03:00`) };
  const estoqueRecife: Record<number, number> = { 1: 100, 2: 80, 3: 40, 4: 60, 5: 5, 6: 200, 7: 30, 8: 0, 9: 0, 10: 50 };
  for (const p of produtos) {
    const sazonal = p.sazonal ? janelaJunina : {};
    // Recife: preço base da rede
    await prisma.cardapioItem.create({ data: { unidadeId: recife.id, produtoId: p.id, ...sazonal } });
    await prisma.estoque.create({ data: { unidadeId: recife.id, produtoId: p.id, quantidade: estoqueRecife[p.id], estoqueMinimo: 10 } });
    // São Paulo: preço regional 15% maior e cozinha reduzida
    await prisma.cardapioItem.create({ data: { unidadeId: sp.id, produtoId: p.id, precoLocal: Math.round(p.precoBase * 115) / 100, ...sazonal } });
    await prisma.estoque.create({ data: { unidadeId: sp.id, produtoId: p.id, quantidade: 40, estoqueMinimo: 5 } });
    // Caruaru: itens juninos de maio a agosto
    const sazonalCaruaru = p.sazonal ? { disponivelDe: new Date(`${ano}-05-01T00:00:00-03:00`), disponivelAte: new Date(`${ano}-08-31T23:59:59-03:00`) } : {};
    await prisma.cardapioItem.create({ data: { unidadeId: caruaru.id, produtoId: p.id, precoLocal: Math.round(p.precoBase * 95) / 100, ...sazonalCaruaru } });
    await prisma.estoque.create({ data: { unidadeId: caruaru.id, produtoId: p.id, quantidade: 60, estoqueMinimo: 10 } });
  }

  // Usuários
  const hash = await bcrypt.hash(SENHA, 10);
  const mk = (id: number, nome: string, email: string, perfil: string, unidadeId: number | null, extra = {}) =>
    prisma.usuario.create({ data: { id, nome, email, senhaHash: hash, perfil, unidadeId, ...extra } });

  await mk(1, 'Francisca Administradora (Matriz)', 'admin@raizes.com', 'ADMIN', null);
  await mk(2, 'Gerente Recife', 'gerente.recife@raizes.com', 'GERENTE', recife.id);
  await mk(3, 'Atendente Recife', 'atendente.recife@raizes.com', 'ATENDENTE', recife.id);
  await mk(4, 'Cozinha Recife', 'cozinha.recife@raizes.com', 'COZINHA', recife.id);
  await mk(5, 'Gerente São Paulo', 'gerente.sp@raizes.com', 'GERENTE', sp.id);
  const maria = await mk(6, 'Maria Cliente', 'maria@cliente.com', 'CLIENTE', null, { telefone: '81999991234', dataNascimento: new Date('1995-06-24') });
  const joao = await mk(7, 'João Cliente', 'joao@cliente.com', 'CLIENTE', null, { telefone: '11988887777' });

  // Maria aceitou fidelidade e marketing; João recusou fidelidade.
  await prisma.consentimento.createMany({
    data: [
      { usuarioId: maria.id, finalidade: 'FIDELIDADE', concedido: true, versaoTermo: '2026.1', canal: 'APP' },
      { usuarioId: maria.id, finalidade: 'MARKETING', concedido: true, versaoTermo: '2026.1', canal: 'APP' },
      { usuarioId: joao.id, finalidade: 'FIDELIDADE', concedido: false, versaoTermo: '2026.1', canal: 'WEB' },
      { usuarioId: joao.id, finalidade: 'MARKETING', concedido: false, versaoTermo: '2026.1', canal: 'WEB' },
    ],
  });
  const conta = await prisma.contaFidelidade.create({ data: { usuarioId: maria.id, saldoPontos: 500 } });
  await prisma.transacaoPontos.create({ data: { contaId: conta.id, tipo: 'ACUMULO', pontos: 500, descricao: 'Bônus de boas-vindas (seed)' } });

  // Promoções
  await prisma.promocao.createMany({
    data: [
      { codigo: 'BEMVINDO10', descricao: '10% de desconto em qualquer canal', tipo: 'PERCENTUAL', valor: 10, inicio: new Date(`${ano}-01-01T00:00:00Z`), fim: new Date(`${ano + 1}-12-31T23:59:59Z`) },
      { codigo: 'APP5', descricao: 'R$ 5 de desconto em pedidos pelo App acima de R$ 30', tipo: 'VALOR_FIXO', valor: 5, canalPedido: 'APP', valorMinimo: 30, inicio: new Date(`${ano}-01-01T00:00:00Z`), fim: new Date(`${ano + 1}-12-31T23:59:59Z`) },
      { codigo: 'SAOJOAO', descricao: '15% nos dias de São João', tipo: 'PERCENTUAL', valor: 15, inicio: new Date(`${ano}-06-20T00:00:00Z`), fim: new Date(`${ano}-06-30T23:59:59Z`) },
    ],
  });

  // Pedidos antigos para os relatórios
  const historicos = [
    { unidadeId: 1, canal: 'APP', clienteId: maria.id, itens: [[1, 2], [6, 2]] },
    { unidadeId: 1, canal: 'BALCAO', clienteId: null, itens: [[3, 1], [5, 1]] },
    { unidadeId: 1, canal: 'TOTEM', clienteId: joao.id, itens: [[7, 1]] },
    { unidadeId: 2, canal: 'WEB', clienteId: joao.id, itens: [[2, 2], [6, 1]] },
    { unidadeId: 2, canal: 'PICKUP', clienteId: maria.id, itens: [[1, 1], [4, 2]] },
    { unidadeId: 3, canal: 'BALCAO', clienteId: null, itens: [[10, 4], [5, 2]] },
  ];
  for (const [i, h] of historicos.entries()) {
    const precoDe = (pid: number) => {
      const base = produtos.find((p) => p.id === pid)!.precoBase;
      return h.unidadeId === 2 ? Math.round(base * 115) / 100 : h.unidadeId === 3 ? Math.round(base * 95) / 100 : base;
    };
    const linhas = h.itens.map(([pid, qtd]) => ({ produtoId: pid, quantidade: qtd, precoUnitario: precoDe(pid), subtotal: Math.round(precoDe(pid) * qtd * 100) / 100 }));
    const total = Math.round(linhas.reduce((a, l) => a + l.subtotal, 0) * 100) / 100;
    const criadoEm = new Date(Date.now() - (i + 1) * 86_400_000);
    await prisma.pedido.create({
      data: {
        unidadeId: h.unidadeId, clienteId: h.clienteId, operadorId: h.canal === 'BALCAO' ? 3 : null,
        canalPedido: h.canal, status: 'ENTREGUE', formaPagamento: h.canal === 'BALCAO' ? 'DINHEIRO' : 'PIX',
        subtotal: total, total, criadoEm,
        itens: { create: linhas },
        pagamentos: { create: { provedor: h.canal === 'BALCAO' ? 'CAIXA_LOCAL' : 'MOCK', metodo: 'PIX', valor: total, status: 'APROVADO', transacaoExternaId: `seed_${i + 1}`, criadoEm } },
        historico: { create: [{ statusNovo: 'AGUARDANDO_PAGAMENTO', criadoEm }, { statusAnterior: 'AGUARDANDO_PAGAMENTO', statusNovo: 'ENTREGUE', observacao: 'Pedido histórico (seed)', criadoEm }] },
      },
    });
  }

  console.log('Seed concluído: 3 unidades, 10 produtos, 7 usuários (senha: Senha@123), 3 promoções, 6 pedidos históricos.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
