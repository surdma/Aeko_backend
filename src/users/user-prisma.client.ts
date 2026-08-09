import { DomainError } from '../common/errors/domain.error';

export interface UserRecord {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly image: string | null;
  readonly avatar: string | null;
  readonly profilePicture: string | null;
  readonly coverPicture: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
  readonly createdAt: Date;
  readonly privacy: unknown;
  readonly blockedUsers: unknown;
  readonly followers: unknown;
  readonly following: unknown;
}

interface FindManyRequest {
  readonly search: string;
  readonly skip: number;
  readonly take: number;
  readonly ids?: readonly string[];
}

export interface UserPrismaClient {
  findUnique(id: string): Promise<UserRecord | null>;
  findMany(request: FindManyRequest): Promise<readonly UserRecord[]>;
  count(search: string): Promise<number>;
  deleteInTransaction(id: string): Promise<void>;
  updatePicture(
    id: string,
    purpose: 'profile' | 'cover',
    url: string,
  ): Promise<string>;
}

export const createUserPrismaClient = (client: object): UserPrismaClient => {
  const userDelegate = readObject(client, 'user');
  requireMethod(userDelegate, 'findUnique');
  requireMethod(userDelegate, 'findMany');
  requireMethod(userDelegate, 'count');
  requireMethod(userDelegate, 'delete');
  requireMethod(client, '$transaction');

  return {
    async findUnique(id) {
      const value = await invoke(userDelegate, 'findUnique', [
        { where: { id }, select: userSelection },
      ]);
      return value === null ? null : parseUserRecord(value);
    },
    async findMany({ search, skip, take, ids }) {
      const where = ids
        ? { id: { in: [...ids] } }
        : search.length > 0
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {};
      const value = await invoke(userDelegate, 'findMany', [
        {
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          select: userSelection,
        },
      ]);
      if (!Array.isArray(value)) invalidResult('findMany');
      return value.map(parseUserRecord);
    },
    async count(search) {
      const where =
        search.length > 0
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {};
      const value = await invoke(userDelegate, 'count', [{ where }]);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        invalidResult('count');
      }
      return value;
    },
    async deleteInTransaction(id) {
      await invoke(client, '$transaction', [
        async (transaction: unknown) => {
          const transactionObject = requireObject(transaction, 'transaction');
          const transactionUser = readObject(transactionObject, 'user');
          requireMethod(transactionUser, 'delete');
          await invoke(transactionUser, 'delete', [{ where: { id } }]);
        },
      ]);
    },
    async updatePicture(id, purpose, url) {
      requireMethod(userDelegate, 'update');
      const field = purpose === 'profile' ? 'profilePicture' : 'coverPicture';
      const value = await invoke(userDelegate, 'update', [
        {
          where: { id },
          data: { [field]: url },
          select: { [field]: true },
        },
      ]);
      const record = requireObject(value, 'update result');
      const storedUrl = readString(record, field);
      if (storedUrl !== url) invalidResult(field);
      return storedUrl;
    },
  };
};

const userSelection = {
  id: true,
  username: true,
  name: true,
  image: true,
  avatar: true,
  profilePicture: true,
  coverPicture: true,
  bio: true,
  location: true,
  blueTick: true,
  goldenTick: true,
  createdAt: true,
  privacy: true,
  blockedUsers: true,
  followers: true,
  following: true,
} as const;

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
  if (typeof Reflect.get(target, method) !== 'function')
    missingBoundary(method);
};

const readObject = (target: object, key: string): object =>
  requireObject(Reflect.get(target, key), key);

const requireObject = (value: unknown, key: string): object => {
  if (typeof value !== 'object' || value === null) missingBoundary(key);
  return value;
};

const parseUserRecord = (value: unknown): UserRecord => {
  const record = requireObject(value, 'user result');
  return {
    id: readString(record, 'id'),
    username: readString(record, 'username'),
    name: readString(record, 'name'),
    image: readNullableString(record, 'image'),
    avatar: readNullableString(record, 'avatar'),
    profilePicture: readNullableString(record, 'profilePicture'),
    coverPicture: readNullableString(record, 'coverPicture'),
    bio: readNullableString(record, 'bio'),
    location: readNullableString(record, 'location'),
    blueTick: readBoolean(record, 'blueTick'),
    goldenTick: readBoolean(record, 'goldenTick'),
    createdAt: readDate(record, 'createdAt'),
    privacy: Reflect.get(record, 'privacy'),
    blockedUsers: Reflect.get(record, 'blockedUsers'),
    followers: Reflect.get(record, 'followers'),
    following: Reflect.get(record, 'following'),
  };
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

const readBoolean = (value: object, key: string): boolean => {
  const property: unknown = Reflect.get(value, key);
  if (typeof property !== 'boolean') invalidResult(key);
  return property;
};

const readDate = (value: object, key: string): Date => {
  const property: unknown = Reflect.get(value, key);
  if (!(property instanceof Date) || Number.isNaN(property.getTime())) {
    invalidResult(key);
  }
  return property;
};

function missingBoundary(member: string): never {
  void member;
  throw new DomainError(
    'INTERNAL_ERROR',
    'The user data service is unavailable.',
  );
}

function invalidResult(member: string): never {
  void member;
  throw new DomainError(
    'INTERNAL_ERROR',
    'The user data service is unavailable.',
  );
}
