import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { DomainError } from '../../src/common/errors/domain.error';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { UsersController } from '../../src/users/users.controller';
import { UsersService } from '../../src/users/users.service';

interface FixtureUser {
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

const publicUser: FixtureUser = {
  id: 'user-public',
  username: 'ada',
  name: 'Ada Lovelace',
  image: null,
  avatar: null,
  profilePicture: null,
  coverPicture: null,
  bio: 'Computing pioneer',
  location: null,
  blueTick: true,
  goldenTick: false,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  privacy: { isPrivate: false },
  blockedUsers: [],
  followers: ['blocker'],
  following: ['private-user'],
};

const privateUser: FixtureUser = {
  ...publicUser,
  id: 'private-user',
  username: 'grace',
  name: 'Grace Hopper',
  privacy: { isPrivate: true },
  followers: ['follower'],
  following: ['user-public'],
};

const blocker: FixtureUser = {
  ...publicUser,
  id: 'blocker',
  username: 'blocked',
  name: 'Blocked User',
  blockedUsers: [{ userId: 'viewer' }],
  followers: [],
  following: [],
};

const malformedUser: FixtureUser = {
  ...publicUser,
  id: 'malformed-user',
  username: 'malformed',
  name: 'Malformed User',
  blockedUsers: [{ unexpected: true }],
};

const fixtures = new Map(
  [publicUser, privateUser, blocker, malformedUser].map((user) => [
    user.id,
    user,
  ]),
);

const memberPrincipal: AuthenticatedPrincipal = {
  userId: 'viewer',
  email: 'viewer@example.com',
  username: 'viewer',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-member',
};

const adminPrincipal: AuthenticatedPrincipal = {
  ...memberPrincipal,
  userId: 'admin',
  email: 'admin@example.com',
  username: 'admin',
  isAdmin: true,
  sessionId: 'session-admin',
};

const selfPrincipal: AuthenticatedPrincipal = {
  ...memberPrincipal,
  userId: 'user-public',
};

const unsatisfiedPrincipal: AuthenticatedPrincipal = {
  ...memberPrincipal,
  twoFactorSatisfied: false,
};

const unsatisfiedWithoutEnrollment: AuthenticatedPrincipal = {
  ...memberPrincipal,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
};

let viewerFindUniqueCalls = 0;

const readPathId = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return '';
  const where: unknown = Reflect.get(input, 'where');
  if (typeof where !== 'object' || where === null) return '';
  const id: unknown = Reflect.get(where, 'id');
  return typeof id === 'string' ? id : '';
};

const readIds = (input: unknown): readonly string[] => {
  if (typeof input !== 'object' || input === null) return [];
  const where: unknown = Reflect.get(input, 'where');
  if (typeof where !== 'object' || where === null) return [];
  const id: unknown = Reflect.get(where, 'id');
  if (typeof id !== 'object' || id === null) return [];
  const values: unknown = Reflect.get(id, 'in');
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
};

const hasAdaSearch = (input: unknown): boolean =>
  JSON.stringify(input).toLocaleLowerCase().includes('ada');

const userDelegate = {
  findUnique: async (input: unknown): Promise<FixtureUser | null> => {
    const id = readPathId(input);
    if (id === 'viewer') viewerFindUniqueCalls += 1;
    return fixtures.get(id) ?? null;
  },
  findMany: async (input: unknown): Promise<readonly FixtureUser[]> => {
    const ids = readIds(input);
    if (ids.length > 0) {
      return ids.flatMap((id) => {
        const user = fixtures.get(id);
        return user ? [user] : [];
      });
    }
    return hasAdaSearch(input) ? [publicUser] : [publicUser, privateUser];
  },
  count: async (input: unknown): Promise<number> =>
    hasAdaSearch(input) ? 1 : 2,
  delete: async (input: unknown): Promise<FixtureUser> => {
    const user = fixtures.get(readPathId(input));
    if (!user) throw new Error('fixture user missing');
    return user;
  },
};

const fakeClient = {
  $connect: async (): Promise<void> => undefined,
  $disconnect: async (): Promise<void> => undefined,
  $queryRaw: async (): Promise<unknown> => 1,
  $transaction: async (operation: unknown): Promise<unknown> => {
    if (typeof operation !== 'function') throw new Error('expected callback');
    return Reflect.apply(operation, undefined, [fakeClient]);
  },
  user: userDelegate,
};

const createService = (): unknown =>
  Reflect.construct(UsersService, [new PrismaService(fakeClient)]);

const invoke = async (
  service: unknown,
  method: string,
  args: readonly unknown[],
): Promise<unknown> => {
  if (typeof service !== 'object' || service === null) {
    throw new Error('UsersService was not constructed');
  }
  const candidate: unknown = Reflect.get(service, method);
  expect(typeof candidate).toBe('function');
  if (typeof candidate !== 'function') throw new Error(`${method} is missing`);
  return Promise.resolve(Reflect.apply(candidate, service, args));
};

const expectDomainError = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('users endpoints', () => {
  beforeEach(() => {
    viewerFindUniqueCalls = 0;
  });

  it('registers only the five active users routes under /api/users', () => {
    const controllerPath: unknown = Reflect.getMetadata(
      PATH_METADATA,
      UsersController,
    );
    expect(controllerPath).toBe('api/users');
    const prototype: object = UsersController.prototype;
    const routes = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler: unknown = Reflect.get(prototype, name);
        return {
          method:
            typeof handler === 'function'
              ? Reflect.getMetadata(METHOD_METADATA, handler)
              : undefined,
          path:
            typeof handler === 'function'
              ? Reflect.getMetadata(PATH_METADATA, handler)
              : undefined,
        };
      });

    expect(routes).toEqual(
      expect.arrayContaining([
        { method: RequestMethod.GET, path: '/' },
        { method: RequestMethod.GET, path: ':id' },
        { method: RequestMethod.GET, path: ':id/followers' },
        { method: RequestMethod.GET, path: ':id/following' },
        { method: RequestMethod.DELETE, path: ':id' },
      ]),
    );
    expect(routes).toHaveLength(5);
    expect(routes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'register' }),
        expect.objectContaining({ path: 'login' }),
      ]),
    );
  });

  it('lists projected users with normalized pagination and search semantics', async () => {
    const result = await invoke(createService(), 'listUsers', [
      'viewer',
      { page: 1, limit: 20, search: 'ada' },
    ]);

    expect(result).toMatchObject({
      items: [expect.objectContaining({ id: 'user-public', username: 'ada' })],
      page: { page: 1, limit: 20, total: 1, pages: 1 },
    });
    expect(JSON.stringify(result)).not.toContain('blockedUsers');
    expect(JSON.stringify(result)).not.toContain('privacy');
  });

  it('loads the viewer at most once while filtering a multi-user page', async () => {
    await invoke(createService(), 'listUsers', [
      'viewer',
      { page: 1, limit: 20, search: '' },
    ]);

    expect(viewerFindUniqueCalls).toBeLessThanOrEqual(1);
  });

  it('returns not found for absent or mutually blocked profiles', async () => {
    const service = createService();
    await expectDomainError(
      invoke(service, 'getUser', ['viewer', 'missing']),
      'NOT_FOUND',
    );
    await expectDomainError(
      invoke(service, 'getUser', ['viewer', 'blocker']),
      'NOT_FOUND',
    );
  });

  it('does not expose persisted field names in internal errors', async () => {
    const promise = invoke(createService(), 'getUser', [
      'viewer',
      'malformed-user',
    ]);

    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Stored user data could not be processed.',
    });
    await expect(promise).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('blockedUsers'),
    );
  });

  it('does not expose Prisma delegate members when its boundary is unavailable', () => {
    const incompleteClient = {
      $connect: async (): Promise<void> => undefined,
      $disconnect: async (): Promise<void> => undefined,
      $queryRaw: async (): Promise<unknown> => 1,
      $transaction: async (): Promise<unknown> => undefined,
      user: {
        findMany: userDelegate.findMany,
        count: userDelegate.count,
        delete: userDelegate.delete,
      },
    };

    expect(() =>
      Reflect.construct(UsersService, [new PrismaService(incompleteClient)]),
    ).toThrow('The user data service is unavailable.');
    expect(() =>
      Reflect.construct(UsersService, [new PrismaService(incompleteClient)]),
    ).not.toThrow('findUnique');
  });

  it('returns a limited private profile with numeric graph counts to a non-follower', async () => {
    const service = createService();
    await expect(
      invoke(service, 'getUser', ['viewer', 'private-user']),
    ).resolves.toMatchObject({
      id: 'private-user',
      isPrivate: true,
      followersCount: 1,
      followingCount: 1,
    });
  });

  it('paginates follower and following lists and filters mutually blocked members', async () => {
    const service = createService();
    await expect(
      invoke(service, 'followers', [
        'viewer',
        'user-public',
        { page: 1, limit: 20 },
      ]),
    ).resolves.toEqual({
      items: [],
      page: { page: 1, limit: 20, total: 1, pages: 1 },
    });
    await expect(
      invoke(service, 'following', [
        'viewer',
        'user-public',
        { page: 1, limit: 20 },
      ]),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'private-user' })],
      page: { page: 1, limit: 20, total: 1, pages: 1 },
    });
  });

  it('enforces private visibility for follower and following lists', async () => {
    const service = createService();
    await expectDomainError(
      invoke(service, 'followers', [
        'viewer',
        'private-user',
        { page: 1, limit: 20 },
      ]),
      'AUTHORIZATION_DENIED',
    );
    await expect(
      invoke(service, 'following', [
        'follower',
        'private-user',
        { page: 1, limit: 20 },
      ]),
    ).resolves.toMatchObject({ page: { total: 1 } });
  });

  it('allows deletion only for self or administrator with satisfied two-factor auth', async () => {
    const service = createService();
    await expectDomainError(
      invoke(service, 'deleteUser', [memberPrincipal, 'user-public']),
      'AUTHORIZATION_DENIED',
    );
    await expectDomainError(
      invoke(service, 'deleteUser', [unsatisfiedPrincipal, 'viewer']),
      'TWO_FACTOR_REQUIRED',
    );
    await expectDomainError(
      invoke(service, 'deleteUser', [unsatisfiedWithoutEnrollment, 'viewer']),
      'TWO_FACTOR_REQUIRED',
    );
    await expect(
      invoke(service, 'deleteUser', [adminPrincipal, 'user-public']),
    ).resolves.toEqual({ deleted: true });
    await expect(
      invoke(service, 'deleteUser', [selfPrincipal, 'user-public']),
    ).resolves.toEqual({ deleted: true });
  });

  it('returns not found when deleting an absent account', async () => {
    await expectDomainError(
      invoke(createService(), 'deleteUser', [adminPrincipal, 'missing']),
      'NOT_FOUND',
    );
  });
});
