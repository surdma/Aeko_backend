import type { Prisma } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue } from '../common/json/json-value';
import type { PrismaTransaction } from '../database/prisma/prisma.service';
import type { SecurityEventQuery } from './security.contract';

export interface SecurityEventRecord {
  readonly id: string;
  readonly eventType: string;
  readonly targetUserId: string | null;
  readonly metadata: unknown;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly timestamp: Date;
  readonly success: boolean;
}

export interface SecurityEventStatRecord {
  readonly eventType: string;
  readonly count: number;
  readonly lastOccurrence: Date;
}

export interface CreateSecurityEventData {
  readonly userId: string;
  readonly eventType: string;
  readonly targetUserId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly success: boolean;
  readonly errorMessage: string | null;
}

export interface SecurityEventPrismaClient {
  create(input: CreateSecurityEventData): Promise<void>;
  list(
    userId: string,
    query: SecurityEventQuery,
  ): Promise<readonly SecurityEventRecord[]>;
  count(userId: string, query: SecurityEventQuery): Promise<number>;
  stats(
    userId: string,
    startDate: Date,
  ): Promise<readonly SecurityEventStatRecord[]>;
}

const selection = {
  id: true,
  eventType: true,
  targetUserId: true,
  metadata: true,
  ipAddress: true,
  userAgent: true,
  timestamp: true,
  success: true,
} satisfies Prisma.SecurityEventSelect;

const createWhere = (
  userId: string,
  query: SecurityEventQuery,
): Prisma.SecurityEventWhereInput => ({
  userId,
  ...(query.eventType ? { eventType: query.eventType } : {}),
  ...(query.startDate || query.endDate
    ? {
        timestamp: {
          ...(query.startDate ? { gte: query.startDate } : {}),
          ...(query.endDate ? { lte: query.endDate } : {}),
        },
      }
    : {}),
});

export const createSecurityEventPrismaClient = (
  db: PrismaTransaction,
): SecurityEventPrismaClient => ({
  async create(input) {
    await db.securityEvent.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        targetUserId: input.targetUserId,
        metadata: toJsonValue(input.metadata) as Prisma.InputJsonValue,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        success: input.success,
        errorMessage: input.errorMessage,
      },
    });
  },

  async list(userId, query) {
    const rows = await db.securityEvent.findMany({
      where: createWhere(userId, query),
      orderBy: { timestamp: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: selection,
    });
    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  },

  async count(userId, query) {
    return db.securityEvent.count({ where: createWhere(userId, query) });
  },

  async stats(userId, startDate) {
    const rows = await db.securityEvent.groupBy({
      by: ['eventType'],
      where: { userId, timestamp: { gte: startDate } },
      _count: { _all: true },
      _max: { timestamp: true },
    });
    return Object.freeze(
      rows.map((row) => {
        const lastOccurrence = row._max.timestamp;
        if (lastOccurrence === null) {
          throw new DomainError(
            'INTERNAL_ERROR',
            'Stored security event data could not be processed.',
          );
        }
        return Object.freeze({
          eventType: row.eventType,
          count: row._count._all,
          lastOccurrence,
        });
      }),
    );
  },
});
