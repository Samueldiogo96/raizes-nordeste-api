/**
 * Composição (injeção de dependências manual).
 * É aqui — e só aqui — que as implementações concretas da infraestrutura
 * são "plugadas" nos casos de uso. Trocar o MockPaymentGateway por um provedor
 * real (ex.: Stripe, Mercado Pago, Cielo) significa mudar uma linha.
 */
import { AuthService } from './application/services/auth.service';
import { EstoqueService } from './application/services/estoque.service';
import { FidelidadeService } from './application/services/fidelidade.service';
import { GestaoService } from './application/services/gestao.service';
import { PagamentoService } from './application/services/pagamento.service';
import { PedidoService } from './application/services/pedido.service';
import { ProdutoService } from './application/services/produto.service';
import { UnidadeService } from './application/services/unidade.service';
import { UsuarioService } from './application/services/usuario.service';
import { PrismaAuditLogger } from './infrastructure/audit/prisma-audit-logger';
import { MockPaymentGateway } from './infrastructure/payment/mock-payment-gateway';

const audit = new PrismaAuditLogger();
const gateway = new MockPaymentGateway();

const pedidoService = new PedidoService(audit, gateway);

export const services = {
  auth: new AuthService(audit),
  usuarios: new UsuarioService(audit),
  unidades: new UnidadeService(audit),
  produtos: new ProdutoService(audit),
  estoque: new EstoqueService(audit),
  pedidos: pedidoService,
  pagamentos: new PagamentoService(audit, gateway, pedidoService),
  fidelidade: new FidelidadeService(),
  gestao: new GestaoService(audit),
};
