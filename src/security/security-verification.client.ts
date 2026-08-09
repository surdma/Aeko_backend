import { DomainError } from '../common/errors/domain.error';

export interface VerificationCandidate {
  readonly id: string;
  readonly followers: unknown;
  readonly postsCount: number;
  readonly profilePicture: string | null;
  readonly coverPicture: string | null;
  readonly bio: string | null;
}

export interface VerificationRules {
  readonly minFollowers: number;
  readonly minPosts: number;
  readonly requiresProfilePic: boolean;
  readonly requiresCoverPic: boolean;
  readonly requiresBio: boolean;
}

export interface SecurityVerificationClient {
  findCandidate(id: string): Promise<VerificationCandidate | null>;
  findRules(): Promise<VerificationRules | null>;
  markVerified(id: string): Promise<void>;
}

export const createSecurityVerificationClient = (
  client: object,
): SecurityVerificationClient => {
  const user = readObject(client, 'user');
  const settings = readObject(client, 'verificationSettings');
  for (const method of ['findUnique', 'update']) requireMethod(user, method);
  requireMethod(settings, 'findFirst');
  return {
    async findCandidate(id) {
      const value = await invoke(user, 'findUnique', [
        {
          where: { id },
          select: {
            id: true,
            followers: true,
            profilePicture: true,
            coverPicture: true,
            bio: true,
            _count: { select: { posts_posts_userIdTousers: true } },
          },
        },
      ]);
      return value === null ? null : parseCandidate(value);
    },
    async findRules() {
      const value = await invoke(settings, 'findFirst', [
        {
          select: {
            minFollowers: true,
            minPosts: true,
            requiresProfilePic: true,
            requiresCoverPic: true,
            requiresBio: true,
          },
        },
      ]);
      return value === null ? null : parseRules(value);
    },
    async markVerified(id) {
      await invoke(user, 'update', [
        { where: { id }, data: { blueTick: true }, select: { id: true } },
      ]);
    },
  };
};

const parseCandidate = (value: unknown): VerificationCandidate => {
  const record = requireObject(value);
  const count = requireObject(Reflect.get(record, '_count'));
  const followers: unknown = Reflect.get(record, 'followers');
  return Object.freeze({
    id: readString(record, 'id'),
    followers,
    postsCount: readNonNegativeInteger(count, 'posts_posts_userIdTousers'),
    profilePicture: readNullableString(record, 'profilePicture'),
    coverPicture: readNullableString(record, 'coverPicture'),
    bio: readNullableString(record, 'bio'),
  });
};

const parseRules = (value: unknown): VerificationRules => {
  const record = requireObject(value);
  return Object.freeze({
    minFollowers: readNonNegativeInteger(record, 'minFollowers'),
    minPosts: readNonNegativeInteger(record, 'minPosts'),
    requiresProfilePic: readBoolean(record, 'requiresProfilePic'),
    requiresCoverPic: readBoolean(record, 'requiresCoverPic'),
    requiresBio: readBoolean(record, 'requiresBio'),
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
const readNonNegativeInteger = (record: object, key: string): number => {
  const value: unknown = Reflect.get(record, key);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    invalidStored();
  return value;
};
function unavailable(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'The verification data service is unavailable.',
  );
}
function invalidStored(): never {
  throw new DomainError(
    'INTERNAL_ERROR',
    'Stored verification data could not be processed.',
  );
}
