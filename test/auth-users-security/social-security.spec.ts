import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { ProfilesController } from '../../src/profiles/profiles.controller';
import { ProfilesService } from '../../src/profiles/profiles.service';
import {
  parseFollowRequestAction,
  parseFollowRequestQuery,
  parsePrivacySettings,
  parseSocialUserId,
} from '../../src/security/security.contract';
import { SecurityController } from '../../src/security/security.controller';
import { SecurityService } from '../../src/security/security.service';

interface StoredUser {
  id: string;
  username: string;
  name: string;
  profilePicture: string | null;
  image: string | null;
  avatar: string | null;
  coverPicture: string | null;
  bio: string | null;
  location: string | null;
  blueTick: boolean;
  goldenTick: boolean;
  createdAt: Date;
  blockedUsers: unknown;
  privacy: unknown;
  followRequests: unknown;
  followers: unknown;
  following: unknown;
}

const users = new Map<string, StoredUser>();
let transactionAttempts = 0;
let retryFailures = 0;
let providerFailure = false;

const seed = (): void => {
  users.clear();
  follows.clear();
  blocks.clear();
  for (const [id, isPrivate] of [
    ['a', false],
    ['b', false],
    ['private', true],
    ['c', false],
  ] as const) {
    users.set(id, {
      id,
      username: id,
      name: id.toUpperCase(),
      profilePicture: null,
      image: null,
      avatar: null,
      coverPicture: null,
      bio: null,
      location: null,
      blueTick: false,
      goldenTick: false,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      blockedUsers: [],
      privacy: {
        isPrivate,
        allowFollowRequests: true,
        showOnlineStatus: true,
        allowDirectMessages: 'everyone',
        allowComments: true,
        allowTags: true,
      },
      followRequests: [],
      followers: [],
      following: [],
    });
  }
};

const readId = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return '';
  const where: unknown = Reflect.get(input, 'where');
  if (typeof where !== 'object' || where === null) return '';
  const id: unknown = Reflect.get(where, 'id');
  return typeof id === 'string' ? id : '';
};

const readData = (input: unknown): object => {
  if (typeof input !== 'object' || input === null) return {};
  const data: unknown = Reflect.get(input, 'data');
  return typeof data === 'object' && data !== null ? data : {};
};

const readInIds = (input: unknown): readonly string[] => {
  if (typeof input !== 'object' || input === null) return [];
  const where: unknown = Reflect.get(input, 'where');
  if (typeof where !== 'object' || where === null) return [];
  const id: unknown = Reflect.get(where, 'id');
  if (typeof id !== 'object' || id === null) return [];
  const list: unknown = Reflect.get(id, 'in');
  return Array.isArray(list)
    ? list.filter((value): value is string => typeof value === 'string')
    : [];
};

/** Relational dual-write targets. `follows` is keyed `follower->followee`. */
const follows = new Map<string, string>();
const blocks = new Set<string>();

const readObject = (input: unknown, key: string): unknown =>
  typeof input === 'object' && input !== null
    ? Reflect.get(input, key)
    : undefined;

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const client = {
  $connect: (): Promise<void> => Promise.resolve(),
  $disconnect: (): Promise<void> => Promise.resolve(),
  $queryRaw: (): Promise<unknown> => Promise.resolve(1),
  $transaction: async (operation: unknown): Promise<unknown> => {
    transactionAttempts += 1;
    if (providerFailure)
      return Promise.reject(new Error('raw database secret'));
    if (retryFailures > 0) {
      retryFailures -= 1;
      return Promise.reject(
        Object.assign(new Error('write conflict'), { code: 'P2034' }),
      );
    }
    if (typeof operation !== 'function') throw new Error('callback required');
    return Reflect.apply(operation, client, [client]);
  },
  follow: {
    upsert: (input: unknown): Promise<unknown> => {
      const where = readObject(input, 'where');
      const composite = readObject(where, 'followerId_followeeId');
      const state = readObject(readObject(input, 'create'), 'state');
      follows.set(
        `${asText(readObject(composite, 'followerId'))}->${asText(
          readObject(composite, 'followeeId'),
        )}`,
        asText(state),
      );
      return Promise.resolve({});
    },
    deleteMany: (input: unknown): Promise<unknown> => {
      const where = readObject(input, 'where');
      follows.delete(
        `${asText(readObject(where, 'followerId'))}->${asText(
          readObject(where, 'followeeId'),
        )}`,
      );
      return Promise.resolve({ count: 1 });
    },
  },
  block: {
    upsert: (input: unknown): Promise<unknown> => {
      const where = readObject(input, 'where');
      const composite = readObject(where, 'blockerId_blockedId');
      blocks.add(
        `${asText(readObject(composite, 'blockerId'))}->${asText(
          readObject(composite, 'blockedId'),
        )}`,
      );
      return Promise.resolve({});
    },
    deleteMany: (input: unknown): Promise<unknown> => {
      const where = readObject(input, 'where');
      blocks.delete(
        `${asText(readObject(where, 'blockerId'))}->${asText(
          readObject(where, 'blockedId'),
        )}`,
      );
      return Promise.resolve({ count: 1 });
    },
  },
  user: {
    findUnique: (input: unknown): Promise<StoredUser | null> =>
      Promise.resolve(users.get(readId(input)) ?? null),
    update: (input: unknown): Promise<StoredUser> => {
      const id = readId(input);
      const stored = users.get(id);
      if (!stored)
        return Promise.reject(
          Object.assign(new Error('missing'), { code: 'P2025' }),
        );
      const updated = Object.assign(stored, readData(input));
      users.set(id, updated);
      return Promise.resolve(updated);
    },
    findMany: (input: unknown): Promise<readonly StoredUser[]> => {
      const ids = readInIds(input);
      const query = JSON.stringify(input).toLowerCase();
      return Promise.resolve(
        [...users.values()].filter(
          (user) =>
            (ids.length === 0 || ids.includes(user.id)) &&
            (!query.includes('contains') || query.includes(user.username)),
        ),
      );
    },
  },
  post: { findMany: (): Promise<readonly unknown[]> => Promise.resolve([]) },
  comment: { findMany: (): Promise<readonly unknown[]> => Promise.resolve([]) },
  securityEvent: {
    findMany: (): Promise<readonly unknown[]> => Promise.resolve([]),
  },
  verificationSettings: {
    findFirst: (): Promise<null> => Promise.resolve(null),
  },
};

const services = (): {
  security: SecurityService;
  profiles: ProfilesService;
} => {
  const prisma = new PrismaService(client);
  const security = new SecurityService(prisma);
  return { security, profiles: new ProfilesService(prisma, security) };
};

const metadata = (key: string, target: object): unknown => {
  const reader: unknown = Reflect.get(Reflect, 'getMetadata');
  if (typeof reader !== 'function') throw new Error('metadata reader missing');
  return Reflect.apply(reader, Reflect, [key, target]);
};

const routes = (controller: object): readonly object[] =>
  Object.getOwnPropertyNames(controller)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler: unknown = Reflect.get(controller, name);
      return typeof handler === 'function'
        ? [
            {
              method: metadata(METHOD_METADATA, handler),
              path: metadata(PATH_METADATA, handler),
            },
          ]
        : [];
    });

describe('social security migration', () => {
  beforeEach(() => {
    seed();
    transactionAttempts = 0;
    retryFailures = 0;
    providerFailure = false;
  });

  it('registers the exact protected security and profile routes without 2FA compatibility', () => {
    expect(metadata(PATH_METADATA, SecurityController)).toBe('api/security');
    expect(routes(SecurityController.prototype)).toEqual(
      expect.arrayContaining([
        { method: RequestMethod.POST, path: 'block/:userId' },
        { method: RequestMethod.DELETE, path: 'block/:userId' },
        { method: RequestMethod.GET, path: 'blocked' },
        { method: RequestMethod.GET, path: 'block-status/:userId' },
        { method: RequestMethod.PUT, path: 'privacy' },
        { method: RequestMethod.GET, path: 'privacy' },
        { method: RequestMethod.POST, path: 'follow-request/:userId' },
        { method: RequestMethod.PUT, path: 'follow-request/:requesterId' },
        { method: RequestMethod.GET, path: 'follow-requests' },
      ]),
    );
    expect(JSON.stringify(routes(SecurityController.prototype))).not.toContain(
      '2fa',
    );
    expect(metadata(GUARDS_METADATA, SecurityController)).toContain(
      SessionGuard,
    );
    expect(routes(ProfilesController.prototype)).toEqual(
      expect.arrayContaining([
        { method: RequestMethod.GET, path: 'followers' },
        { method: RequestMethod.GET, path: 'following' },
        { method: RequestMethod.GET, path: 'followers/search' },
        { method: RequestMethod.PUT, path: 'follow/:id' },
        { method: RequestMethod.PUT, path: 'unfollow/:id' },
      ]),
    );
  });

  it('parses exact legacy privacy and follow request contracts strictly', () => {
    expect(parseSocialUserId('  user-1  ')).toBe('user-1');
    expect(() => parseSocialUserId('   ')).toThrow('userId');
    expect(parsePrivacySettings({ isPrivate: true })).toEqual({
      isPrivate: true,
      allowFollowRequests: true,
      showOnlineStatus: true,
      allowDirectMessages: 'everyone',
      allowComments: true,
      allowTags: true,
    });
    expect(parseFollowRequestAction({ action: 'approve' })).toBe('approve');
    expect(
      parseFollowRequestQuery({ status: 'all', page: '0', limit: '500' }),
    ).toEqual({
      status: 'all',
      page: 1,
      limit: 100,
    });
    expect(() => parsePrivacySettings({ isPrivate: 'yes' })).toThrow(
      'isPrivate',
    );
  });

  it('merges partial privacy updates without resetting persisted settings', async () => {
    const { security } = services();
    await expect(
      security.updatePrivacy('private', { showOnlineStatus: false }),
    ).resolves.toMatchObject({
      isPrivate: true,
      showOnlineStatus: false,
      allowFollowRequests: true,
    });
  });

  it('denies self block and makes block/unblock idempotent with relationship cleanup', async () => {
    const { security } = services();
    await expect(security.block('a', 'a', null)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(security.follow('a', 'b')).resolves.toEqual({
      state: 'following',
    });
    await expect(
      security.block('a', 'b', 'private reason'),
    ).resolves.toMatchObject({ state: 'blocked' });
    await expect(security.block('a', 'b', null)).resolves.toMatchObject({
      state: 'blocked',
    });
    await expect(security.unblock('a', 'b')).resolves.toEqual({
      state: 'unblocked',
    });
    await expect(security.unblock('a', 'b')).resolves.toEqual({
      state: 'unblocked',
    });
    expect(users.get('a')).toMatchObject({ following: [], blockedUsers: [] });
    expect(users.get('b')).toMatchObject({ followers: [] });
  });

  it('conceals mutual blocks while reporting both directions to the participants', async () => {
    const { security } = services();
    await security.block('a', 'b', null);
    await security.block('b', 'a', null);
    await expect(security.blockStatus('a', 'b')).resolves.toEqual({
      isBlocked: true,
      isBlockedBy: true,
      canInteract: false,
    });
    await expect(security.follow('a', 'b')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('follows public users, requests private users, and resolves only for the recipient', async () => {
    const { security } = services();
    await expect(
      Promise.all([security.follow('a', 'b'), security.follow('a', 'b')]),
    ).resolves.toEqual([{ state: 'following' }, { state: 'following' }]);
    await expect(security.follow('a', 'private')).resolves.toEqual({
      state: 'requested',
    });
    await expect(security.follow('a', 'private')).resolves.toEqual({
      state: 'requested',
    });
    await expect(
      security.resolveFollowRequest('c', 'a', 'approve'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      security.resolveFollowRequest('private', 'a', 'approve'),
    ).resolves.toEqual({ status: 'approved' });
    await expect(
      security.resolveFollowRequest('private', 'a', 'approve'),
    ).resolves.toEqual({ status: 'approved' });
    expect(users.get('private')?.followers).toEqual(['a']);
    expect(users.get('a')?.following).toEqual(
      expect.arrayContaining(['b', 'private']),
    );
    // Dual-write: a public follow lands as `accepted`; a request against a
    // private account lands as `requested` and is promoted on approval.
    expect([...follows.entries()].sort()).toEqual([
      ['a->b', 'accepted'],
      ['a->private', 'accepted'],
    ]);
  });

  it('dual-writes a pending follow request as a requested edge', async () => {
    const { security } = services();
    await expect(security.requestFollow('a', 'private')).resolves.toEqual({
      state: 'requested',
    });
    expect([...follows.entries()]).toEqual([['a->private', 'requested']]);
  });

  it('removes the relational edge when a follow request is rejected', async () => {
    const { security } = services();
    await security.requestFollow('a', 'private');
    await security.resolveFollowRequest('private', 'a', 'reject');
    expect([...follows.keys()]).toEqual([]);
  });

  it('dual-writes a block, severs both follow edges, and clears on unblock', async () => {
    const { security } = services();
    await security.follow('a', 'b');
    await security.follow('b', 'a');
    expect([...follows.keys()].sort()).toEqual(['a->b', 'b->a']);

    await expect(security.block('a', 'b', 'spam')).resolves.toEqual({
      state: 'blocked',
    });
    expect([...blocks]).toEqual(['a->b']);
    // Blocking severs the relation in both directions.
    expect([...follows.keys()]).toEqual([]);

    await expect(security.unblock('a', 'b')).resolves.toEqual({
      state: 'unblocked',
    });
    expect([...blocks]).toEqual([]);
  });

  it('removes the relational edge on unfollow', async () => {
    const { security } = services();
    await security.follow('a', 'b');
    expect([...follows.keys()]).toEqual(['a->b']);
    await security.unfollow('a', 'b');
    expect([...follows.keys()]).toEqual([]);
  });

  it('makes rejection deterministic and hides stale requests from blocked requesters', async () => {
    const { security } = services();
    await security.requestFollow('a', 'private');
    await expect(
      security.resolveFollowRequest('private', 'a', 'reject'),
    ).resolves.toEqual({ status: 'rejected' });
    await expect(
      security.resolveFollowRequest('private', 'a', 'reject'),
    ).resolves.toEqual({ status: 'rejected' });
    const recipient = users.get('private');
    if (recipient) {
      recipient.blockedUsers = [
        { user: 'a', blockedAt: new Date().toISOString(), reason: 'hidden' },
      ];
      recipient.followRequests = [
        { user: 'a', requestedAt: new Date().toISOString(), status: 'pending' },
      ];
    }
    await expect(
      security.followRequests('private', { status: 'all', page: 1, limit: 20 }),
    ).resolves.toEqual({
      requests: [],
      page: { page: 1, limit: 20, total: 0, pages: 0 },
    });
  });

  it('retries serializable P2034 conflicts at most three attempts', async () => {
    retryFailures = 2;
    await expect(services().security.follow('a', 'b')).resolves.toEqual({
      state: 'following',
    });
    expect(transactionAttempts).toBe(3);
    retryFailures = 3;
    await expect(services().security.follow('a', 'c')).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(transactionAttempts).toBe(6);
  });

  it('sanitizes unexpected database failures', async () => {
    providerFailure = true;
    const promise = services().security.follow('a', 'b');
    await expect(promise).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      message: 'The request could not be completed. Please try again.',
    });
    await expect(promise).rejects.not.toThrow('raw database secret');
  });

  it('filters profile graph/search for blocks and handles malformed JSON safely', async () => {
    const { security, profiles } = services();
    await security.follow('b', 'a');
    await security.follow('c', 'a');
    await security.block('a', 'c', null);
    await expect(
      profiles.followers('a', { page: 1, limit: 100 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'b' })],
      page: { total: 1 },
    });
    await expect(
      profiles.searchFollowers('a', { search: 'b', page: 1, limit: 100 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'b' })],
    });
    const a = users.get('a');
    if (a) a.followers = { malformed: true };
    await expect(
      profiles.followers('a', { page: 1, limit: 20 }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Stored social data could not be processed.',
    });
  });
});
