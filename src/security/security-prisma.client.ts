import { DomainError } from '../common/errors/domain.error';

export interface SocialUserRecord {
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
  readonly blockedUsers: unknown;
  readonly privacy: unknown;
  readonly followRequests: unknown;
  readonly followers: unknown;
  readonly following: unknown;
}

export interface SocialTransaction {
  findUser(id: string): Promise<SocialUserRecord | null>;
  updateUser(
    id: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  findUsers(
    ids: readonly string[],
    search: string,
  ): Promise<readonly SocialUserRecord[]>;
}

export interface SocialPrismaClient extends SocialTransaction {
  transaction(
    operation: (transaction: SocialTransaction) => Promise<unknown>,
  ): Promise<unknown>;
}

export const createSocialPrismaClient = (
  client: object,
): SocialPrismaClient => {
  requireMethod(client, '$transaction');
  const direct = createTransaction(client);
  return {
    ...direct,
    async transaction(operation) {
      const callback = async (transactionClient: unknown): Promise<unknown> =>
        operation(createTransaction(requireObject(transactionClient)));
      return invoke(client, '$transaction', [
        callback,
        { isolationLevel: 'Serializable' },
      ]);
    },
  };
};

const createTransaction = (client: object): SocialTransaction => {
  const user = requireObject(Reflect.get(client, 'user'));
  for (const method of ['findUnique', 'update', 'findMany'])
    requireMethod(user, method);
  return {
    async findUser(id) {
      const value = await invoke(user, 'findUnique', [
        { where: { id }, select: selection },
      ]);
      return value === null ? null : parseUser(value);
    },
    async updateUser(id, data) {
      await invoke(user, 'update', [{ where: { id }, data }]);
    },
    async findUsers(ids, search) {
      if (ids.length === 0) return [];
      const where: Record<string, unknown> = { id: { in: [...ids] } };
      if (search !== '')
        where.username = { contains: search, mode: 'insensitive' };
      const value = await invoke(user, 'findMany', [
        { where, select: selection },
      ]);
      if (!Array.isArray(value)) invalidStored();
      return value.map(parseUser);
    },
  };
};

const selection = {
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
  blockedUsers: true,
  privacy: true,
  followRequests: true,
  followers: true,
  following: true,
} as const;

const parseUser = (value: unknown): SocialUserRecord => {
  const record = requireObject(value, invalidStored);
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
    blockedUsers: Reflect.get(record, 'blockedUsers'),
    privacy: Reflect.get(record, 'privacy'),
    followRequests: Reflect.get(record, 'followRequests'),
    followers: Reflect.get(record, 'followers'),
    following: Reflect.get(record, 'following'),
  };
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
const requireObject = (
  value: unknown,
  fail: () => never = unavailable,
): object => {
  if (typeof value !== 'object' || value === null) fail();
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
    'The social data service is unavailable.',
  );
}
function invalidStored(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'Stored social data could not be processed.',
  );
}
