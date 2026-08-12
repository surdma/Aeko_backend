import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { DomainError } from '../../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../../common/json/json-value';

export type WritableJson = Exclude<JsonValue, null>;

export interface CommunityTransactionRecord {
  readonly id: string;
  readonly userId: string;
  readonly communityId: string | null;
  readonly amount: number;
  readonly paymentMethod: string;
  readonly status: string;
}

export interface CommunityRecord {
  readonly id: string;
  readonly members: JsonValue;
  readonly memberCount: number;
  readonly settings: JsonValue;
}

export interface CommunitySettlementClient {
  findTransaction(id: string): Promise<CommunityTransactionRecord | null>;
  /**
   * Moves a not-yet-completed transaction to `completed` and reports whether
   * this call is the one that moved it. Legacy read the status outside the
   * transaction that writes it, so a redelivered webhook settled twice: a
   * second membership row, a second member count and a second earnings credit.
   *
   * The gate is `not completed` rather than `pending` so that a payment which
   * settles after a failed initialisation is still honoured — legacy also
   * short-circuited only on `completed`, and narrowing it would take the money
   * without granting the membership.
   */
  claimTransaction(id: string): Promise<boolean>;
  findCommunity(id: string): Promise<CommunityRecord | null>;
  saveMembership(
    id: string,
    members: WritableJson,
    memberCount: number,
  ): Promise<void>;
  /**
   * The relational half of the membership.
   *
   * Legacy wrote a paid membership only into the JSON above, while every
   * request path — the community detail, the leave check, the join check, the
   * post guard — reads `CommunityMember`. A member who paid was therefore
   * invisible everywhere except the column that recorded the payment. Both are
   * written here; reads stay relational, and the JSON keeps being written so
   * anything outside this migration still reading it keeps working.
   *
   * Reports whether the row was newly created, so the member count moves once.
   */
  upsertRelationalMember(communityId: string, userId: string): Promise<boolean>;
  saveSettings(id: string, settings: WritableJson): Promise<void>;
  findUserCommunities(userId: string): Promise<JsonValue | undefined>;
  saveUserCommunities(userId: string, communities: WritableJson): Promise<void>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface CommunityPaymentPrismaClient {
  runSerializable<T>(
    operation: (transaction: CommunitySettlementClient) => Promise<T>,
  ): Promise<T>;
}

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const settlementOps = (
  transaction: Prisma.TransactionClient,
): CommunitySettlementClient => ({
  async findTransaction(id) {
    const row = await transaction.transaction.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        communityId: true,
        amount: true,
        paymentMethod: true,
        status: true,
      },
    });
    return row === null ? null : Object.freeze({ ...row });
  },

  async claimTransaction(id) {
    const claimed = await transaction.transaction.updateMany({
      where: { id, status: { not: 'completed' } },
      data: { status: 'completed', verifiedAt: new Date() },
    });
    return claimed.count === 1;
  },

  async findCommunity(id) {
    const row = await transaction.community.findUnique({
      where: { id },
      select: { id: true, members: true, memberCount: true, settings: true },
    });
    return row === null
      ? null
      : Object.freeze({
          id: row.id,
          members: toJsonValue(row.members),
          memberCount: row.memberCount,
          settings: toJsonValue(row.settings),
        });
  },

  async saveMembership(id, members, memberCount) {
    await transaction.community.update({
      where: { id },
      data: { members: jsonInput(members), memberCount },
    });
  },

  async upsertRelationalMember(communityId, userId) {
    const existing = await transaction.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { id: true, status: true },
    });

    if (existing === null) {
      await transaction.communityMember.create({
        data: { communityId, userId, role: 'member', status: 'active' },
      });
      return true;
    }

    // A renewal reactivates without changing the role they already hold.
    if (existing.status !== 'active') {
      await transaction.communityMember.update({
        where: { communityId_userId: { communityId, userId } },
        data: { status: 'active' },
      });
    }
    return false;
  },

  async saveSettings(id, settings) {
    await transaction.community.update({
      where: { id },
      data: { settings: jsonInput(settings) },
    });
  },

  async findUserCommunities(userId) {
    const row = await transaction.user.findUnique({
      where: { id: userId },
      select: { communities: true },
    });
    return row === null ? undefined : toJsonValue(row.communities);
  },

  async saveUserCommunities(userId, communities) {
    await transaction.user.update({
      where: { id: userId },
      data: { communities: jsonInput(communities) },
    });
  },
});

export const createCommunityPaymentPrismaClient = (
  db: PrismaClient,
): CommunityPaymentPrismaClient => ({
  async runSerializable<T>(
    operation: (transaction: CommunitySettlementClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) => operation(settlementOps(transaction)),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (!isWriteConflict(error)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'That payment is still being processed. Please try again.',
    );
  },
});
