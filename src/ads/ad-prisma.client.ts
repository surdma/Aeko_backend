import type { Prisma, PrismaClient } from '../../prisma/generated/client';
import { DomainError } from '../common/errors/domain.error';
import type { AdStatus, JsonValue } from './ad.contract';
import { AD_STATUSES } from './ad.contract';

export interface AdAdvertiser {
  readonly username: string;
  readonly profilePicture: string | null;
  readonly blueTick: boolean;
}

/**
 * A row of the canonical `ads` table. The legacy database column is the
 * mixed-case `Status`; that name is now confined to a single `@map` in the
 * Prisma schema, so nothing in TypeScript refers to it.
 */
export interface AdRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly mediaType: string;
  readonly mediaUrl: string | null;
  readonly mediaUrls: readonly string[];
  readonly targetAudience: JsonValue;
  readonly budget: JsonValue;
  readonly pricing: JsonValue;
  readonly campaign: JsonValue;
  readonly advertiserId: string;
  readonly status: AdStatus;
  readonly callToAction: JsonValue;
  readonly analytics: JsonValue;
  readonly review: JsonValue;
  readonly placement: JsonValue;
  readonly frequency: JsonValue;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly advertiser: AdAdvertiser | null;
}

export interface AdViewerRecord {
  readonly id: string;
  readonly age: number | null;
  readonly location: string | null;
  readonly followerCount: number;
}

export interface OwnedAdQuery {
  readonly advertiserId: string;
  readonly status: AdStatus | null;
  readonly skip: number;
  readonly take: number;
}

export interface StatusPageQuery {
  readonly status: AdStatus;
  readonly skip: number;
  readonly take: number;
}

export interface AdWriteData {
  readonly [key: string]: JsonValue | Date | readonly string[] | undefined;
}

/** The subset of the boundary that is safe to use inside a transaction. */
export interface AdTransactionClient {
  findById(id: string): Promise<AdRecord | null>;
  update(
    id: string,
    data: AdWriteData,
    status: AdStatus | null,
  ): Promise<AdRecord>;
}

export interface AdPrismaClient {
  create(data: AdWriteData, status: AdStatus): Promise<AdRecord>;
  /**
   * Runs `operation` at `Serializable` isolation, retrying up to
   * {@link SERIALIZABLE_ATTEMPTS} times when the database reports a write
   * conflict (P2034). Counter updates read-modify-write JSON columns, so a
   * weaker isolation level would silently lose concurrent increments.
   */
  runSerializable<T>(
    operation: (transaction: AdTransactionClient) => Promise<T>,
  ): Promise<T>;
  findById(id: string): Promise<AdRecord | null>;
  findOwned(query: OwnedAdQuery): Promise<readonly AdRecord[]>;
  countOwned(advertiserId: string, status: AdStatus | null): Promise<number>;
  findRunning(): Promise<readonly AdRecord[]>;
  findByStatus(query: StatusPageQuery): Promise<readonly AdRecord[]>;
  countByStatus(status: AdStatus): Promise<number>;
  findCreatedBetween(
    advertiserId: string,
    from: Date,
    to: Date,
  ): Promise<readonly AdRecord[]>;
  update(
    id: string,
    data: AdWriteData,
    status: AdStatus | null,
  ): Promise<AdRecord>;
  delete(id: string): Promise<void>;
  findViewer(id: string): Promise<AdViewerRecord | null>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

const WRITE_CONFLICT_CODE = 'P2034';

const isWriteConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === WRITE_CONFLICT_CODE;

const advertiserInclude = {
  user: { select: { username: true, profilePicture: true, blueTick: true } },
} satisfies Prisma.AdInclude;

type AdRow = Prisma.AdGetPayload<{ include: typeof advertiserInclude }>;

const ownedWhere = (
  advertiserId: string,
  status: AdStatus | null,
): Prisma.AdWhereInput =>
  status === null ? { advertiserId } : { advertiserId, status };

/**
 * `AdWriteData` is assembled from validated request contracts rather than from
 * Prisma input types, so the shape is checked at the contract layer. Prisma
 * still validates column names and types against the schema at runtime.
 */
const writeInput = (
  data: AdWriteData,
  status: AdStatus | null,
): Prisma.AdUncheckedUpdateInput =>
  status === null ? { ...data } : { ...data, status };

const toAdRecord = (row: AdRow): AdRecord =>
  Object.freeze({
    id: row.id,
    title: row.title,
    description: row.description,
    mediaType: row.mediaType,
    mediaUrl: row.mediaUrl,
    mediaUrls: Object.freeze([...row.mediaUrls]),
    targetAudience: toJsonValue(row.targetAudience),
    budget: toJsonValue(row.budget),
    pricing: toJsonValue(row.pricing),
    campaign: toJsonValue(row.campaign),
    advertiserId: row.advertiserId,
    status: readStatus(row.status),
    callToAction: toJsonValue(row.callToAction),
    analytics: toJsonValue(row.analytics),
    review: toJsonValue(row.review),
    placement: toJsonValue(row.placement),
    frequency: toJsonValue(row.frequency),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    advertiser: readAdvertiser(row.user),
  });

/**
 * `Ad.user` is a required relation, so a row without one only happens when the
 * caller omitted the include. Preserved as `null` rather than a throw, matching
 * the previous boundary.
 */
const readAdvertiser = (user: AdRow['user'] | null): AdAdvertiser | null =>
  user === null || user === undefined
    ? null
    : Object.freeze({
        username: user.username,
        profilePicture: user.profilePicture,
        blueTick: user.blueTick,
      });

/** `Ad.status` is still a free-text column, so the value needs narrowing. */
const readStatus = (value: string): AdStatus => {
  const match = AD_STATUSES.find((status) => status === value);
  if (match === undefined) invalidResult('status');
  return match;
};

const countFollowers = (value: Prisma.JsonValue): number => {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 0;
};

const adOperations = (
  delegate: Prisma.TransactionClient['ad'],
): AdTransactionClient => ({
  async findById(id) {
    const row = await delegate.findUnique({
      where: { id },
      include: advertiserInclude,
    });
    return row === null ? null : toAdRecord(row);
  },
  async update(id, data, status) {
    return toAdRecord(
      await delegate.update({
        where: { id },
        data: writeInput(data, status),
        include: advertiserInclude,
      }),
    );
  },
});

export const createAdPrismaClient = (db: PrismaClient): AdPrismaClient => ({
  async create(data, status) {
    const row = await db.ad.create({
      data: { ...data, status } as Prisma.AdUncheckedCreateInput,
      include: advertiserInclude,
    });
    return toAdRecord(row);
  },

  async runSerializable<T>(
    operation: (transaction: AdTransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) => operation(adOperations(transaction.ad)),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (!isWriteConflict(error)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'That advertisement is being updated. Please try again.',
    );
  },

  async findById(id) {
    const row = await db.ad.findUnique({
      where: { id },
      include: advertiserInclude,
    });
    return row === null ? null : toAdRecord(row);
  },

  async findOwned({ advertiserId, status, skip, take }) {
    const rows = await db.ad.findMany({
      where: ownedWhere(advertiserId, status),
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: advertiserInclude,
    });
    return rows.map(toAdRecord);
  },

  async countOwned(advertiserId, status) {
    return db.ad.count({ where: ownedWhere(advertiserId, status) });
  },

  async findRunning() {
    const rows = await db.ad.findMany({
      where: { status: 'running' },
      include: advertiserInclude,
    });
    return rows.map(toAdRecord);
  },

  async findByStatus({ status, skip, take }) {
    const rows = await db.ad.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: advertiserInclude,
    });
    return rows.map(toAdRecord);
  },

  async countByStatus(status) {
    return db.ad.count({ where: { status } });
  },

  async findCreatedBetween(advertiserId, from, to) {
    const rows = await db.ad.findMany({
      where: { advertiserId, createdAt: { gte: from, lte: to } },
      include: advertiserInclude,
    });
    return rows.map(toAdRecord);
  },

  async update(id, data, status) {
    return toAdRecord(
      await db.ad.update({
        where: { id },
        data: writeInput(data, status),
        include: advertiserInclude,
      }),
    );
  },

  async delete(id) {
    await db.ad.delete({ where: { id } });
  },

  async findViewer(id) {
    const row = await db.user.findUnique({
      where: { id },
      select: { id: true, location: true, followers: true },
    });
    if (row === null) return null;
    return {
      id: row.id,
      // `users` has no age column. The previous boundary selected `age`, which
      // made every call fail Prisma validation; age targeting is skipped for a
      // null age, which is the behaviour the matcher already handles.
      age: null,
      location: row.location,
      followerCount: countFollowers(row.followers),
    };
  },
});

/**
 * Prisma returns `Json` columns as arbitrary values. Normalizing here keeps
 * `undefined`, functions, and cyclic references out of every response body.
 */
export const toJsonValue = (value: unknown): JsonValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return Object.freeze(value.map(toJsonValue));
  if (typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'function' ? [] : [[key, toJsonValue(entry)] as const],
    );
    return Object.freeze(Object.fromEntries(entries));
  }
  return null;
};

function invalidResult(name: string): never {
  throw new DomainError(
    'DATABASE_UNAVAILABLE',
    'The advertising service returned an unexpected record.',
    { field: [name] },
  );
}
