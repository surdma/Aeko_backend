import { DomainError } from '../common/errors/domain.error';
import type { AdStatus, JsonValue } from './ad.contract';
import { AD_STATUSES } from './ad.contract';

export interface AdAdvertiser {
  readonly username: string;
  readonly profilePicture: string | null;
  readonly blueTick: boolean;
}

/**
 * A row of the canonical `ads` table. The legacy column is `Status`; this
 * boundary is the only place that name is allowed to exist, so every caller
 * above it reads and writes the API field `status`.
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

export interface AdWriteData {
  readonly [key: string]: JsonValue | Date | readonly string[] | undefined;
}

export interface AdPrismaClient {
  create(data: AdWriteData, status: AdStatus): Promise<AdRecord>;
  findById(id: string): Promise<AdRecord | null>;
  findOwned(query: OwnedAdQuery): Promise<readonly AdRecord[]>;
  countOwned(advertiserId: string, status: AdStatus | null): Promise<number>;
  findRunning(): Promise<readonly AdRecord[]>;
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

export const createAdPrismaClient = (client: object): AdPrismaClient => {
  const adDelegate = readObject(client, 'ad');
  const userDelegate = readObject(client, 'user');
  requireMethod(adDelegate, 'create');
  requireMethod(adDelegate, 'findUnique');
  requireMethod(adDelegate, 'findMany');
  requireMethod(adDelegate, 'count');
  requireMethod(adDelegate, 'update');
  requireMethod(adDelegate, 'delete');
  requireMethod(userDelegate, 'findUnique');

  return {
    async create(data, status) {
      const value = await invoke(adDelegate, 'create', [
        { data: { ...data, Status: status }, include: advertiserInclude },
      ]);
      return parseAdRecord(value);
    },
    async findById(id) {
      const value = await invoke(adDelegate, 'findUnique', [
        { where: { id }, include: advertiserInclude },
      ]);
      return value === null || value === undefined
        ? null
        : parseAdRecord(value);
    },
    async findOwned({ advertiserId, status, skip, take }) {
      const value = await invoke(adDelegate, 'findMany', [
        {
          where: ownedWhere(advertiserId, status),
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          include: advertiserInclude,
        },
      ]);
      return parseAdRecords(value);
    },
    async countOwned(advertiserId, status) {
      const value = await invoke(adDelegate, 'count', [
        { where: ownedWhere(advertiserId, status) },
      ]);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        invalidResult('count');
      }
      return value;
    },
    async findRunning() {
      const value = await invoke(adDelegate, 'findMany', [
        { where: { Status: 'running' }, include: advertiserInclude },
      ]);
      return parseAdRecords(value);
    },
    async findCreatedBetween(advertiserId, from, to) {
      const value = await invoke(adDelegate, 'findMany', [
        {
          where: { advertiserId, createdAt: { gte: from, lte: to } },
          include: advertiserInclude,
        },
      ]);
      return parseAdRecords(value);
    },
    async update(id, data, status) {
      const value = await invoke(adDelegate, 'update', [
        {
          where: { id },
          data: status === null ? { ...data } : { ...data, Status: status },
          include: advertiserInclude,
        },
      ]);
      return parseAdRecord(value);
    },
    async delete(id) {
      await invoke(adDelegate, 'delete', [{ where: { id } }]);
    },
    async findViewer(id) {
      const value = await invoke(userDelegate, 'findUnique', [
        { where: { id }, select: viewerSelection },
      ]);
      if (value === null || value === undefined) return null;
      const record = requireObject(value, 'viewer result');
      return {
        id: readString(record, 'id'),
        age: readNullableNumber(record, 'age'),
        location: readNullableString(record, 'location'),
        followerCount: countFollowers(Reflect.get(record, 'followers')),
      };
    },
  };
};

const advertiserInclude = {
  user: { select: { username: true, profilePicture: true, blueTick: true } },
} as const;

const viewerSelection = {
  id: true,
  age: true,
  location: true,
  followers: true,
} as const;

const ownedWhere = (
  advertiserId: string,
  status: AdStatus | null,
): Readonly<Record<string, string>> =>
  status === null ? { advertiserId } : { advertiserId, Status: status };

const countFollowers = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 0;
};

const parseAdRecords = (value: unknown): readonly AdRecord[] => {
  if (!Array.isArray(value)) invalidResult('findMany');
  return value.map(parseAdRecord);
};

const parseAdRecord = (value: unknown): AdRecord => {
  const record = requireObject(value, 'ad result');
  return Object.freeze({
    id: readString(record, 'id'),
    title: readString(record, 'title'),
    description: readString(record, 'description'),
    mediaType: readString(record, 'mediaType'),
    mediaUrl: readNullableString(record, 'mediaUrl'),
    mediaUrls: Object.freeze(readStringArray(record, 'mediaUrls')),
    targetAudience: readJson(record, 'targetAudience'),
    budget: readJson(record, 'budget'),
    pricing: readJson(record, 'pricing'),
    campaign: readJson(record, 'campaign'),
    advertiserId: readString(record, 'advertiserId'),
    status: readStatus(record),
    callToAction: readJson(record, 'callToAction'),
    analytics: readJson(record, 'analytics'),
    review: readJson(record, 'review'),
    placement: readJson(record, 'placement'),
    frequency: readJson(record, 'frequency'),
    createdAt: readDate(record, 'createdAt'),
    updatedAt: readDate(record, 'updatedAt'),
    advertiser: readAdvertiser(Reflect.get(record, 'user')),
  });
};

const readStatus = (record: object): AdStatus => {
  const value: unknown = Reflect.get(record, 'Status');
  const match = AD_STATUSES.find((status) => status === value);
  if (match === undefined) invalidResult('Status');
  return match;
};

const readAdvertiser = (value: unknown): AdAdvertiser | null => {
  if (typeof value !== 'object' || value === null) return null;
  return Object.freeze({
    username: readString(value, 'username'),
    profilePicture: readNullableString(value, 'profilePicture'),
    blueTick: Reflect.get(value, 'blueTick') === true,
  });
};

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

const readJson = (record: object, key: string): JsonValue =>
  toJsonValue(Reflect.get(record, key));

const invoke = async (
  target: object,
  method: string,
  args: readonly unknown[],
): Promise<unknown> => {
  const candidate: unknown = Reflect.get(target, method);
  if (typeof candidate !== 'function') missingBoundary(method);
  return Promise.resolve(Reflect.apply(candidate, target, args));
};

const requireMethod = (target: object, method: string): void => {
  if (typeof Reflect.get(target, method) !== 'function') {
    missingBoundary(method);
  }
};

const readObject = (target: object, key: string): object =>
  requireObject(Reflect.get(target, key), key);

const requireObject = (value: unknown, key: string): object => {
  if (typeof value !== 'object' || value === null) missingBoundary(key);
  return value;
};

const readString = (value: object, key: string): string => {
  const property: unknown = Reflect.get(value, key);
  if (typeof property !== 'string') invalidResult(key);
  return property;
};

const readNullableString = (value: object, key: string): string | null => {
  const property: unknown = Reflect.get(value, key);
  if (property === null || property === undefined) return null;
  if (typeof property !== 'string') invalidResult(key);
  return property;
};

const readNullableNumber = (value: object, key: string): number | null => {
  const property: unknown = Reflect.get(value, key);
  if (property === null || property === undefined) return null;
  if (typeof property !== 'number' || !Number.isFinite(property)) {
    invalidResult(key);
  }
  return property;
};

const readStringArray = (value: object, key: string): string[] => {
  const property: unknown = Reflect.get(value, key);
  if (property === null || property === undefined) return [];
  if (!Array.isArray(property)) invalidResult(key);
  return property.map((entry: unknown) => {
    if (typeof entry !== 'string') invalidResult(key);
    return entry;
  });
};

const readDate = (value: object, key: string): Date => {
  const property: unknown = Reflect.get(value, key);
  if (!(property instanceof Date) || Number.isNaN(property.getTime())) {
    invalidResult(key);
  }
  return property;
};

function missingBoundary(name: string): never {
  throw new DomainError(
    'DATABASE_UNAVAILABLE',
    'The advertising service is temporarily unavailable.',
    { boundary: [name] },
  );
}

function invalidResult(name: string): never {
  throw new DomainError(
    'DATABASE_UNAVAILABLE',
    'The advertising service returned an unexpected record.',
    { field: [name] },
  );
}
