import { DomainError } from '../common/errors/domain.error';
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

export const createSecurityEventPrismaClient = (
  client: object,
): SecurityEventPrismaClient => {
  const delegate = readObject(client, 'securityEvent');
  for (const method of ['create', 'findMany', 'count', 'groupBy'])
    requireMethod(delegate, method);
  return {
    async create(input) {
      await invoke(delegate, 'create', [{ data: { ...input } }]);
    },
    async list(userId, query) {
      const value = await invoke(delegate, 'findMany', [
        {
          where: createWhere(userId, query),
          orderBy: { timestamp: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: selection,
        },
      ]);
      if (!Array.isArray(value)) invalidStored();
      return Object.freeze(value.map(parseRecord));
    },
    async count(userId, query) {
      const value = await invoke(delegate, 'count', [
        { where: createWhere(userId, query) },
      ]);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
        invalidStored();
      return value;
    },
    async stats(userId, startDate) {
      const value = await invoke(delegate, 'groupBy', [
        {
          by: ['eventType'],
          where: { userId, timestamp: { gte: startDate } },
          _count: { _all: true },
          _max: { timestamp: true },
        },
      ]);
      if (!Array.isArray(value)) invalidStored();
      return Object.freeze(value.map(parseStat));
    },
  };
};

const createWhere = (
  userId: string,
  query: SecurityEventQuery,
): Record<string, unknown> => {
  const where: Record<string, unknown> = { userId };
  if (query.eventType) where.eventType = query.eventType;
  if (query.startDate || query.endDate) {
    const timestamp: Record<string, Date> = {};
    if (query.startDate) timestamp.gte = query.startDate;
    if (query.endDate) timestamp.lte = query.endDate;
    where.timestamp = timestamp;
  }
  return where;
};

const selection = {
  id: true,
  eventType: true,
  targetUserId: true,
  metadata: true,
  ipAddress: true,
  userAgent: true,
  timestamp: true,
  success: true,
} as const;

const parseRecord = (value: unknown): SecurityEventRecord => {
  const record = requireObject(value);
  const metadata: unknown = Reflect.get(record, 'metadata');
  return Object.freeze({
    id: readString(record, 'id'),
    eventType: readString(record, 'eventType'),
    targetUserId: readNullableString(record, 'targetUserId'),
    metadata,
    ipAddress: readString(record, 'ipAddress'),
    userAgent: readString(record, 'userAgent'),
    timestamp: readDate(record, 'timestamp'),
    success: readBoolean(record, 'success'),
  });
};

const parseStat = (value: unknown): SecurityEventStatRecord => {
  const record = requireObject(value);
  const count = requireObject(Reflect.get(record, '_count'));
  const maximum = requireObject(Reflect.get(record, '_max'));
  const amount: unknown = Reflect.get(count, '_all');
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0)
    invalidStored();
  return Object.freeze({
    eventType: readString(record, 'eventType'),
    count: amount,
    lastOccurrence: readDate(maximum, 'timestamp'),
  });
};

const invoke = async (
  target: object,
  method: string,
  args: readonly unknown[],
): Promise<unknown> => {
  const candidate: unknown = Reflect.get(target, method);
  if (typeof candidate !== 'function') unavailable();
  return Promise.resolve(Reflect.apply(candidate, target, args));
};
const requireMethod = (target: object, method: string): void => {
  if (typeof Reflect.get(target, method) !== 'function') unavailable();
};
const readObject = (target: object, key: string): object =>
  requireObject(Reflect.get(target, key));
const requireObject = (value: unknown): object => {
  if (typeof value !== 'object' || value === null) invalidStored();
  return value;
};
const readString = (record: object, key: string): string => {
  const value: unknown = Reflect.get(record, key);
  if (typeof value !== 'string') invalidStored();
  return value;
};
const readNullableString = (record: object, key: string): string | null => {
  const value: unknown = Reflect.get(record, key);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalidStored();
  return value;
};
const readBoolean = (record: object, key: string): boolean => {
  const value: unknown = Reflect.get(record, key);
  if (typeof value !== 'boolean') invalidStored();
  return value;
};
const readDate = (record: object, key: string): Date => {
  const value: unknown = Reflect.get(record, key);
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    invalidStored();
  return value;
};
function unavailable(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'The security event data service is unavailable.',
  );
}
function invalidStored(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'Stored security event data could not be processed.',
  );
}
