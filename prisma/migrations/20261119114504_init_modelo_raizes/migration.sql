-- CreateTable
CREATE TABLE "unidades" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "regiao" TEXT NOT NULL,
    "tipo_cozinha" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "perfil" TEXT NOT NULL,
    "telefone" TEXT,
    "data_nascimento" DATETIME,
    "unidade_id" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "anonimizado_em" DATETIME,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" DATETIME NOT NULL,
    CONSTRAINT "usuarios_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "consentimentos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario_id" INTEGER NOT NULL,
    "finalidade" TEXT NOT NULL,
    "concedido" BOOLEAN NOT NULL,
    "versao_termo" TEXT NOT NULL,
    "canal" TEXT,
    "registrado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogado_em" DATETIME,
    CONSTRAINT "consentimentos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "categoria" TEXT NOT NULL,
    "preco_base" DECIMAL NOT NULL,
    "exige_cozinha_completa" BOOLEAN NOT NULL DEFAULT false,
    "sazonal" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "cardapio_itens" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unidade_id" INTEGER NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "preco_local" DECIMAL,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "disponivel_de" DATETIME,
    "disponivel_ate" DATETIME,
    CONSTRAINT "cardapio_itens_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cardapio_itens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "estoques" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unidade_id" INTEGER NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "estoque_minimo" INTEGER NOT NULL DEFAULT 0,
    "atualizado_em" DATETIME NOT NULL,
    CONSTRAINT "estoques_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "estoques_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "movimentacoes_estoque" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unidade_id" INTEGER NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "saldo_apos" INTEGER NOT NULL,
    "motivo" TEXT,
    "pedido_id" INTEGER,
    "usuario_id" INTEGER,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimentacoes_estoque_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "movimentacoes_estoque_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "movimentacoes_estoque_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unidade_id" INTEGER NOT NULL,
    "cliente_id" INTEGER,
    "operador_id" INTEGER,
    "canal_pedido" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "forma_pagamento" TEXT NOT NULL,
    "subtotal" DECIMAL NOT NULL,
    "desconto" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL,
    "pontos_resgatados" INTEGER NOT NULL DEFAULT 0,
    "promocao_id" INTEGER,
    "observacao" TEXT,
    "motivo_cancelamento" TEXT,
    "idempotency_key" TEXT,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" DATETIME NOT NULL,
    CONSTRAINT "pedidos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "pedidos_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "pedidos_promocao_id_fkey" FOREIGN KEY ("promocao_id") REFERENCES "promocoes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "itens_pedido" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pedido_id" INTEGER NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL NOT NULL,
    "subtotal" DECIMAL NOT NULL,
    CONSTRAINT "itens_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "itens_pedido_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "historico_status_pedido" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pedido_id" INTEGER NOT NULL,
    "status_anterior" TEXT,
    "status_novo" TEXT NOT NULL,
    "usuario_id" INTEGER,
    "observacao" TEXT,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historico_status_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pedido_id" INTEGER NOT NULL,
    "provedor" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "valor" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "transacao_externa_id" TEXT,
    "motivo_recusa" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "resposta_gateway" TEXT,
    "idempotency_key" TEXT,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" DATETIME NOT NULL,
    CONSTRAINT "pagamentos_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contas_fidelidade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario_id" INTEGER NOT NULL,
    "saldo_pontos" INTEGER NOT NULL DEFAULT 0,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contas_fidelidade_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transacoes_pontos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conta_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "pontos" INTEGER NOT NULL,
    "pedido_id" INTEGER,
    "descricao" TEXT,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transacoes_pontos_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas_fidelidade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transacoes_pontos_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "promocoes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL NOT NULL,
    "unidade_id" INTEGER,
    "canal_pedido" TEXT,
    "valor_minimo" DECIMAL NOT NULL DEFAULT 0,
    "inicio" DATETIME NOT NULL,
    "fim" DATETIME NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promocoes_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT,
    "usuario_id" INTEGER,
    "perfil" TEXT,
    "detalhes" TEXT,
    "ip" TEXT,
    "request_id" TEXT,
    "criado_em" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_perfil_idx" ON "usuarios"("perfil");

-- CreateIndex
CREATE INDEX "consentimentos_usuario_id_finalidade_idx" ON "consentimentos"("usuario_id", "finalidade");

-- CreateIndex
CREATE UNIQUE INDEX "cardapio_itens_unidade_id_produto_id_key" ON "cardapio_itens"("unidade_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "estoques_unidade_id_produto_id_key" ON "estoques"("unidade_id", "produto_id");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_unidade_id_produto_id_idx" ON "movimentacoes_estoque"("unidade_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_idempotency_key_key" ON "pedidos"("idempotency_key");

-- CreateIndex
CREATE INDEX "pedidos_unidade_id_status_idx" ON "pedidos"("unidade_id", "status");

-- CreateIndex
CREATE INDEX "pedidos_canal_pedido_idx" ON "pedidos"("canal_pedido");

-- CreateIndex
CREATE INDEX "pedidos_cliente_id_idx" ON "pedidos"("cliente_id");

-- CreateIndex
CREATE INDEX "historico_status_pedido_pedido_id_idx" ON "historico_status_pedido"("pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_transacao_externa_id_key" ON "pagamentos"("transacao_externa_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_idempotency_key_key" ON "pagamentos"("idempotency_key");

-- CreateIndex
CREATE INDEX "pagamentos_pedido_id_idx" ON "pagamentos"("pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "contas_fidelidade_usuario_id_key" ON "contas_fidelidade"("usuario_id");

-- CreateIndex
CREATE INDEX "transacoes_pontos_conta_id_idx" ON "transacoes_pontos"("conta_id");

-- CreateIndex
CREATE UNIQUE INDEX "promocoes_codigo_key" ON "promocoes"("codigo");

-- CreateIndex
CREATE INDEX "audit_logs_acao_idx" ON "audit_logs"("acao");

-- CreateIndex
CREATE INDEX "audit_logs_entidade_entidade_id_idx" ON "audit_logs"("entidade", "entidade_id");
