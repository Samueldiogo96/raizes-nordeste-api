# Raízes do Nordeste — API Back-end

API REST da rede de lanchonetes **Raízes do Nordeste**, desenvolvida para o **Projeto Multidisciplinar — Trilha Back-end**.

- **Fluxo crítico entregue (Fluxo A):** Pedido → Pagamento (gateway *mock*) → Atualização de status
- **Multicanal:** todo pedido registra `canalPedido` (`APP`, `TOTEM`, `BALCAO`, `PICKUP`, `WEB`), que pode ser usado como filtro
- **Também implementado:** estoque por unidade, cardápio por unidade (preço regional, itens sazonais, cozinha reduzida), fidelidade com consentimento, promoções, LGPD (consentimento, portabilidade, anonimização, mascaramento), auditoria e relatórios

| Item | Onde |
|---|---|
| Repositório | https://github.com/Samueldiogo96/raizes-nordeste-api |
| Swagger (local) | http://localhost:3000/docs (JSON: http://localhost:3000/openapi.json) |
| Contrato OpenAPI | [`docs/openapi.yaml`](docs/openapi.yaml) |
| Coleção Postman | [`postman/raizes-nordeste.postman_collection.json`](postman/raizes-nordeste.postman_collection.json) + [`postman/local.postman_environment.json`](postman/local.postman_environment.json) |
| DER e diagramas | [`docs/diagramas/`](docs/diagramas/) (fonte Mermaid + PNG) |
| Evidências de teste | [`docs/evidencias/`](docs/evidencias/) |

---

## 1. Requisitos

| Ferramenta | Versão |
|---|---|
| Node.js | 20 ou superior (testado no 22.15) |
| npm | 10 ou superior |
| Banco | SQLite (arquivo local, **não precisa instalar nada**) |
| Postman ou Newman | opcional, para rodar a coleção |

Principais dependências: Express 4, Prisma ORM 6 (migrations), Zod (validação), jsonwebtoken (JWT), bcryptjs (hash de senha), helmet, express-rate-limit, swagger-ui-express.

## 2. Configuração (variáveis de ambiente)

```bash
cp .env.example .env
```

No Windows (PowerShell): `Copy-Item .env.example .env`

| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | Porta HTTP | `3000` |
| `DATABASE_URL` | Caminho do banco SQLite | `file:./dev.db` |
| `JWT_SECRET` | Segredo de assinatura do JWT | troque em produção |
| `JWT_EXPIRES_IN` | Validade do token (segundos) | `3600` |
| `PAYMENT_WEBHOOK_SECRET` | Segredo do webhook do gateway | `segredo-webhook-mock` |
| `PAYMENT_TIMEOUT_MS` / `PAYMENT_MAX_TENTATIVAS` | Timeout e retentativas do gateway | `2000` / `2` |
| `FIDELIDADE_PONTOS_POR_REAL` / `FIDELIDADE_VALOR_PONTO` | Regras de pontos | `1` / `0.05` |

## 3. Instalar, criar o banco e rodar

```bash
npm install
```

```bash
npm run setup
```

`setup` executa as **migrations** (`prisma migrate deploy`) e o **seed** (`prisma db seed`). Para voltar o banco ao estado inicial, rode `npm run setup` de novo: o seed limpa e recria os dados.

```bash
npm run dev
```

A API sobe em http://localhost:3000 e a documentação em **http://localhost:3000/docs**.

## 4. Usuários de teste (seed)

Senha de todos: **`Senha@123`**

| E-mail | Perfil | Unidade |
|---|---|---|
| admin@raizes.com | ADMIN (matriz) | — |
| gerente.recife@raizes.com | GERENTE | 1 — Recife (cozinha completa) |
| atendente.recife@raizes.com | ATENDENTE | 1 |
| cozinha.recife@raizes.com | COZINHA | 1 |
| gerente.sp@raizes.com | GERENTE | 2 — São Paulo (cozinha reduzida) |
| maria@cliente.com | CLIENTE (com fidelidade, 500 pontos) | — |
| joao@cliente.com | CLIENTE (sem consentimento de fidelidade) | — |

**Tokens do gateway de pagamento mock** (campo `tokenPagamento`):
`tok_aprovado`, `tok_recusado`, `tok_cartao_bloqueado`, `tok_pendente` (confirmação via webhook) e `tok_falha_gateway` (simula indisponibilidade → 502).

## 5. Como testar

### 5.1 Testes automatizados (43 testes)

```bash
npm test
```

Usa um banco separado (`prisma/test.db`), recriado a cada execução. Inclui testes unitários das regras de domínio e testes de integração HTTP dos cenários T01–T30. Última execução: [`docs/evidencias/testes-automatizados.txt`](docs/evidencias/testes-automatizados.txt).

### 5.2 Coleção Postman (60 requisições, 105 asserções)

1. `npm run setup` (banco limpo) e `npm run dev`
2. No Postman: **Import** → os dois arquivos da pasta `postman/` → selecione o ambiente **Raízes do Nordeste - Local**
3. Abra a coleção → **Run** (execute na ordem; os tokens e IDs são salvos automaticamente em variáveis)

Ou pela linha de comando (com a API rodando em outro terminal):

```bash
npm run test:postman
```

Pastas: `00 - Auth`, `01 - Catálogo e Cardápio`, `02 - Pedidos`, `03 - Pagamento mock e Status`, `04 - Erros e regras de negócio`, `05 - Multicanal, LGPD, Auditoria e Gestão`. Última execução: [`docs/evidencias/newman-execucao.txt`](docs/evidencias/newman-execucao.txt).

### 5.3 Pelo Swagger

Em http://localhost:3000/docs: `POST /auth/login` → copie o `accessToken` → botão **Authorize** → teste `POST /pedidos` e `POST /pagamentos`.

## 6. Exemplo do fluxo crítico

```http
POST /pedidos
Authorization: Bearer <token>
Idempotency-Key: app-7f3c9a21-0001

{ "unidadeId": 1, "canalPedido": "APP", "itens": [{ "produtoId": 1, "quantidade": 2 }], "formaPagamento": "PIX" }
```
→ `201` com `status: AGUARDANDO_PAGAMENTO` (estoque reservado)

```http
POST /pagamentos
{ "pedidoId": 7, "tokenPagamento": "tok_aprovado" }
```
→ `201` com `status: APROVADO`, `statusPedido: PAGO`, `pontosGanhos`

```http
PATCH /pedidos/7/status   { "status": "EM_PREPARO" }   (perfil COZINHA)
GET   /pedidos?canalPedido=APP&status=PAGO
```

**Padrão de erro (todas as falhas):**

```json
{
  "error": "ESTOQUE_INSUFICIENTE",
  "message": "Não há quantidade suficiente para um ou mais itens.",
  "details": [{ "field": "itens[0].quantidade", "issue": "Produto 5: solicitado 10, disponível 5" }],
  "timestamp": "2026-11-19T12:00:00.000Z",
  "path": "/pedidos",
  "requestId": "8c3c81a4-a1b1-4943-975e-1c0fd7cee343"
}
```

## 7. Estrutura do projeto (camadas)

```
src/
├── domain/            # Regras de negócio puras (sem banco/HTTP): estados do pedido, canal x perfil,
│                      # cálculos em centavos, fidelidade, promoções, disponibilidade, enums e erros
├── application/       # Casos de uso (services) + portas (interfaces PaymentGateway, AuditLogger)
├── infrastructure/    # Prisma (ORM), gateway de pagamento mock, auditoria, logger, bcrypt/JWT, config
├── api/               # Rotas REST, middlewares (JWT, RBAC, validação, erro padrão), schemas zod
├── container.ts       # Injeção de dependências (liga infraestrutura às portas)
└── server.ts          # Inicialização + encerramento gracioso
prisma/                # schema.prisma (modelo = DER), migrations/, seed.ts
docs/                  # openapi.yaml, diagramas/, evidencias/
postman/               # coleção + ambiente
tests/                 # testes unitários (domínio) e de integração (API)
```

## 8. Segurança e LGPD (resumo)

- Senhas com **bcrypt**; nenhuma resposta expõe hash; token JWT carrega só id, perfil e unidade
- **RBAC** por perfil + **escopo por unidade** (funcionário só acessa a própria unidade)
- **Consentimento** por finalidade (FIDELIDADE, MARKETING) com versão do termo e histórico
- **Minimização:** data de nascimento só é guardada com consentimento de marketing
- **Direitos do titular:** `GET /usuarios/me/exportar` (portabilidade) e `DELETE /usuarios/me` (anonimização)
- **Mascaramento** de e-mail/telefone para funcionários + log `ACESSO_DADOS_PESSOAIS`
- **Auditoria** (`GET /auditoria`, ADMIN): criação/cancelamento de pedido, mudança de status, pagamentos, estoque, consentimentos
- **Rate limit** no login (5 falhas/minuto por IP + e-mail) e `helmet` nos headers

## 9. Limitações conhecidas

- SQLite foi escolhido para facilitar a correção; em produção o `provider` muda para PostgreSQL (mesmo schema).
- Sem refresh token / logout no servidor (token curto de 1 h); proposto como evolução.
- Reservas de pedidos não pagos não expiram automaticamente (proposto: job de expiração).
