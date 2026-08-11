import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';

export const SERIALIZABLE_ATTEMPTS = 3;

export interface FollowerTransactionClient {
  /** Reports whether the follow was new; the unique constraint decides. */
  follow(communityId: string, userId: string): Promise<boolean>;
  unfollow(communityId: string, userId: string): Promise<boolean>;
  countFollowers(communityId: string): Promise<number>;
}

export interface CommunityFollowerPrismaClient {
  isFollowing(communityId: string, userId: string): Promise<boolean>;
  countFollowers(communityId: string): Promise<number>;
  runSerializable<T>(
    operation: (transaction: FollowerTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const WRITE_CONFLICT_CODE = 'P2034';
const UNIQUE_VIOLATION_CODE = 'P2002';

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === code;

const transactionOps = (
  transaction: Prisma.TransactionClient,
): FollowerTransactionClient => ({
  async follow(communityId, userId) {
    try {
      await transaction.communityFollower.create({
        data: { communityId, userId },
      });
      return true;
    } catch (error: unknown) {
      if (hasCode(error, UNIQUE_VIOLATION_CODE)) return false;
      throw error;
    }
  },

  async unfollow(communityId, userId) {
    const removed = await transaction.communityFollower.deleteMany({
      where: { communityId, userId },
    });
    return removed.count > 0;
  },

  async countFollowers(communityId) {
    return transaction.communityFollower.count({ where: { communityId } });
  },
});

export const createCommunityFollowerPrismaClient = (
  db: PrismaClient,
): CommunityFollowerPrismaClient => ({
  async isFollowing(communityId, userId) {
    const row = await db.communityFollower.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { id: true },
    });
    return row !== null;
  },

  async countFollowers(communityId) {
    return db.communityFollower.count({ where: { communityId } });
  },

  async runSerializable<T>(
    operation: (transaction: FollowerTransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) => operation(transactionOps(transaction)),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (!hasCode(error, WRITE_CONFLICT_CODE)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'That community is being updated. Please try again.',
    );
  },
});
