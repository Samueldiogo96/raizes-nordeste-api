import { criarApp } from './api/app';
import { config } from './infrastructure/config';
import { prisma } from './infrastructure/database/prisma';
import { logger } from './infrastructure/logger';

const app = criarApp();
const server = app.listen(config.port, () => {
  logger.info('api_iniciada', { porta: config.port, swagger: `http://localhost:${config.port}/docs` });
  console.log(`\n  Raízes do Nordeste API rodando em http://localhost:${config.port}`);
  console.log(`  Swagger (documentação):  http://localhost:${config.port}/docs\n`);
});

// Encerramento gracioso: termina requisições em andamento antes de desligar (deploys sem derrubar pedidos).
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    logger.info('api_encerrando', { sinal });
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
