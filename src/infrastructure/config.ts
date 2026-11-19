import 'dotenv/config';

function num(nome: string, padrao: number): number {
  const v = process.env[nome];
  return v === undefined || v === '' ? padrao : Number(v);
}

function obrigatorio(nome: string, padraoDev?: string): string {
  const v = process.env[nome] ?? padraoDev;
  if (!v) throw new Error(`Variável de ambiente ${nome} não configurada (veja .env.example).`);
  return v;
}

export const config = {
  port: num('PORT', 3000),
  jwtSecret: obrigatorio('JWT_SECRET'),
  jwtExpiresIn: num('JWT_EXPIRES_IN', 3600),
  webhookSecret: obrigatorio('PAYMENT_WEBHOOK_SECRET'),
  paymentTimeoutMs: num('PAYMENT_TIMEOUT_MS', 2000),
  paymentMaxTentativas: num('PAYMENT_MAX_TENTATIVAS', 2),
  pontosPorReal: num('FIDELIDADE_PONTOS_POR_REAL', 1),
  valorPonto: num('FIDELIDADE_VALOR_PONTO', 0.05),
  isTest: process.env.NODE_ENV === 'test',
};
