import { Injectable } from '@nestjs/common';

import { DomainError } from '../../common/errors/domain.error';
import { isJsonObject, type JsonValue } from '../../common/json/json-value';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CommunityPaymentPort } from './community-payment.port';
import {
  createCommunityPaymentPrismaClient,
  type CommunityPaymentPrismaClient,
  type CommunityRecord,
  type CommunitySettlementClient,
} from './community-payment-prisma.client';

/**
 * Settles a paid community membership, mirroring the legacy
 * `handleCommunityPaymentSuccess` exactly: it grants or renews the membership,
 * keeps `User.communities` in step, bumps the member count for a genuinely new
 * member, and credits the community's earnings.
 *
 * Only settlement lives here. Initialising a community payment and withdrawing
 * earnings belong to the `communities` domain and arrive with it. Settlement is
 * carved out because both providers deliver community events down the same two
 * webhook URLs the payments domain already owns, and a payment that cannot be
 * settled when it arrives is a payment at risk.
 */
@Injectable()
export class PrismaCommunityPaymentAdapter extends CommunityPaymentPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private get communities(): CommunityPaymentPrismaClient {
    return createCommunityPaymentPrismaClient(this.prisma.db);
  }

  async settle(transactionId: string): Promise<void> {
    await this.communities.runSerializable(async (transaction) => {
      const record = await transaction.findTransaction(transactionId);
      if (record === null) {
        throw new DomainError('NOT_FOUND', 'Transaction not found');
      }
      if (record.communityId === null) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'That transaction is not a community payment.',
        );
      }

      // The gate: whoever flips pending to completed does the work, once.
      const claimed = await transaction.claimTransaction(record.id);
      if (!claimed) return;

      const community = await transaction.findCommunity(record.communityId);
      if (community === null) {
        throw new DomainError('NOT_FOUND', 'Community not found');
      }

      const subscription = subscriptionFor(
        community,
        record.paymentMethod,
        record.id,
      );

      await grantMembership(
        transaction,
        community,
        record.userId,
        subscription,
      );
      await syncUserCommunities(
        transaction,
        record.userId,
        community.id,
        subscription,
      );
      await creditEarnings(transaction, community, record.amount);
    });
  }
}

interface Subscription {
  readonly [key: string]: JsonValue;
  readonly type: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly isActive: true;
  readonly paymentMethod: string;
  readonly transactionId: string;
}

/**
 * Legacy read the term from `settings.payment.subscriptionType`, defaulting to
 * `one_time`, which stores no end date and so grants lifetime access.
 */
function subscriptionFor(
  community: CommunityRecord,
  paymentMethod: string,
  transactionId: string,
): Subscription {
  const payment = paymentSettings(community.settings);
  const rawType = payment.subscriptionType;
  const type = typeof rawType === 'string' ? rawType : 'one_time';
  const now = new Date();
  const endDate = new Date(now);

  if (type === 'monthly') {
    endDate.setMonth(now.getMonth() + 1);
  } else if (type === 'yearly') {
    endDate.setFullYear(now.getFullYear() + 1);
  }

  return Object.freeze({
    type,
    startDate: now.toISOString(),
    endDate:
      type === 'monthly' || type === 'yearly' ? endDate.toISOString() : null,
    isActive: true as const,
    paymentMethod,
    transactionId,
  });
}

async function grantMembership(
  transaction: CommunitySettlementClient,
  community: CommunityRecord,
  userId: string,
  subscription: Subscription,
): Promise<void> {
  const members = readArray(community.members);
  const index = members.findIndex(
    (entry) => isJsonObject(entry) && entry.user === userId,
  );

  if (index >= 0) {
    const existing = members[index];
    const previous = isJsonObject(existing) ? existing : {};
    const next = [...members];
    next[index] = { ...previous, subscription, status: 'active' };
    // Renewing an existing member must not inflate the member count.
    await transaction.saveMembership(community.id, next, community.memberCount);
    return;
  }

  await transaction.saveMembership(
    community.id,
    [
      ...members,
      { user: userId, role: 'member', status: 'active', subscription },
    ],
    community.memberCount + 1,
  );
}

async function syncUserCommunities(
  transaction: CommunitySettlementClient,
  userId: string,
  communityId: string,
  subscription: Subscription,
): Promise<void> {
  const current = await transaction.findUserCommunities(userId);
  // Legacy read `user.communities` off a possibly-missing row and threw.
  if (current === undefined) {
    throw new DomainError('NOT_FOUND', 'User not found');
  }

  const communities = readArray(current);
  const index = communities.findIndex(
    (entry) => isJsonObject(entry) && entry.community === communityId,
  );

  if (index >= 0) {
    const existing = communities[index];
    const previous = isJsonObject(existing) ? existing : {};
    const next = [...communities];
    next[index] = { ...previous, role: 'member', subscription };
    await transaction.saveUserCommunities(userId, next);
    return;
  }

  await transaction.saveUserCommunities(userId, [
    ...communities,
    {
      community: communityId,
      role: 'member',
      joinedAt: subscription.startDate,
      notifications: true,
      subscription,
    },
  ]);
}

/**
 * Legacy added the amount to a total it had read into memory earlier. Here the
 * read happens inside the same serializable transaction as the write, so two
 * settlements landing together cannot lose one another's earnings.
 */
async function creditEarnings(
  transaction: CommunitySettlementClient,
  community: CommunityRecord,
  amount: number,
): Promise<void> {
  const settings = isJsonObject(community.settings) ? community.settings : {};
  const payment = paymentSettings(community.settings);

  await transaction.saveSettings(community.id, {
    ...settings,
    payment: {
      ...payment,
      availableForWithdrawal:
        readNumber(payment.availableForWithdrawal) + amount,
      totalEarnings: readNumber(payment.totalEarnings) + amount,
    },
  });
}

function paymentSettings(
  settings: JsonValue,
): Readonly<Record<string, JsonValue>> {
  if (!isJsonObject(settings)) return {};
  const payment = settings.payment;
  return isJsonObject(payment) ? payment : {};
}

function readArray(value: JsonValue): readonly JsonValue[] {
  // Array.isArray widens a readonly JSON union to any[]; the annotation keeps
  // the element type honest without a cast.
  const entries: readonly JsonValue[] = Array.isArray(value) ? value : [];
  return entries;
}

function readNumber(value: JsonValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
