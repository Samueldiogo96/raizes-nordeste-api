import { Prisma, PrismaClient } from '@prisma/client';

/** Instância única do Prisma Client. */
export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
