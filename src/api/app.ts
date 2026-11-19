import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { prisma } from '../infrastructure/database/prisma';
import { rotaNaoEncontrada, requestId, tratarErros } from './middlewares';
import { authRouter, usuariosRouter } from './routes/auth-usuarios.routes';
import { estoqueRouter, produtosRouter, unidadesRouter } from './routes/catalogo.routes';
import { auditoriaRouter, fidelidadeRouter, promocoesRouter, relatoriosRouter } from './routes/gestao.routes';
import { pagamentosRouter, pedidosRouter } from './routes/pedidos-pagamentos.routes';

export function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false })); // CSP desligado só para o Swagger UI funcionar
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  // Documentação OpenAPI (contrato real da API)
  const spec = YAML.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'openapi.yaml'), 'utf8'));
  app.get('/openapi.json', (_req, res) => res.json(spec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Raízes do Nordeste — API' }));

  // Health check (usado por load balancer/orquestrador para alta disponibilidade)
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'UP', banco: 'UP', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'DOWN', banco: 'DOWN', timestamp: new Date().toISOString() });
    }
  });

  app.use('/auth', authRouter);
  app.use('/usuarios', usuariosRouter);
  app.use('/unidades', unidadesRouter);
  app.use('/produtos', produtosRouter);
  app.use('/estoque', estoqueRouter);
  app.use('/pedidos', pedidosRouter);
  app.use('/pagamentos', pagamentosRouter);
  app.use('/fidelidade', fidelidadeRouter);
  app.use('/promocoes', promocoesRouter);
  app.use('/relatorios', relatoriosRouter);
  app.use('/auditoria', auditoriaRouter);

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
