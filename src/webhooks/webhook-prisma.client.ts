import type { PrismaClient } from '../generated/prisma/client';

export interface TransactionKind {
  readonly id: string;
  readonly planId: string | null;
  readonly communityId: string | null;
}

export interface WebhookPrismaClient {
  findKind(id: string): Promise<TransactionKind | null>;
  findIdByReference(reference: string): Promise<string | null>;
}

export const createWebhookPrismaClient = (
  db: PrismaClient,
): WebhookPrismaClient => ({
  async findKind(id) {
    const row = await db.transaction.findUnique({
      where: { id },
      select: { id: true, planId: true, communityId: true },
    });
    return row === null
      ? null
      : Object.freeze({
          id: row.id,
          planId: row.planId,
          communityId: row.communityId,
        });
  },

  async findIdByReference(reference) {
    const row = await db.transaction.findFirst({
      where: { paymentReference: reference },
      select: { id: true },
    });
    return row === null ? null : row.id;
  },
});
