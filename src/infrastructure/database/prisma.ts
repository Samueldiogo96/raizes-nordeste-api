import { Prisma, PrismaClient } from '@prisma/client';

/** Cliente único do Prisma (ORM) — conexão com o banco reaproveitada pela aplicação. */
export const prisma = new PrismaClient();

/** Tipo do cliente dentro de uma transação ($transaction). */
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
