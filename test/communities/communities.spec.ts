import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { TwoFactorGuard } from '../../src/auth/guards/two-factor/two-factor.guard';
import { CommunitiesController } from '../../src/communities/communities.controller';
import { CommunitiesService } from '../../src/communities/communities.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';

const EPOCH = new Date('2026-08-01T00:00:00.000Z');

interface CommunityRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  isPrivate: boolean;
  isActive: boolean;
  memberCount: number;
  tags: string[];
  profile: unknown;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface MemberRow {
  communityId: string;
  userId: string;
  role: string;
  status: string;
}

const owner: AuthenticatedPrincipal = {
  userId: 'owner',
  email: 'owner@example.com',
  username: 'owner',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-owner',
};

const joiner: AuthenticatedPrincipal = { ...owner, userId: 'joiner' };

const makeCommunity = (
  overrides: Partial<CommunityRow> = {},
): CommunityRow => ({
  id: 'community-1',
  name: 'Builders',
  description: 'A place for people who build things.',
  ownerId: 'owner',
  isPrivate: false,
  isActive: true,
  memberCount: 1,
  tags: [],
  profile: null,
  settings: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...overrides,
});

class UniqueViolation extends Error {
  readonly code = 'P2002';
}

interface Harness {
  readonly service: CommunitiesService;
  readonly communities: Map<string, CommunityRow>;
  readonly members: MemberRow[];
  readonly chatMembers: Array<{ chatId: string; userId: string }>;
  readonly transactionOptions: unknown[];
  goldenTick: boolean | null;
  lastListWhere: unknown;
}

const key = (communityId: string, userId: string): string =>
  `${communityId}::${userId}`;

const createHarness = (
  options: Readonly<{
    communities?: readonly CommunityRow[];
    members?: readonly MemberRow[];
    goldenTick?: boolean | null;
  }> = {},
): Harness => {
  const communities = new Map(
    (options.communities ?? [makeCommunity()]).map((row) => [row.id, row]),
  );
  const members = [...(options.members ?? [])];
  const chatMembers: Array<{ chatId: string; userId: string }> = [];

  const harness: Harness = {
    service: undefined as unknown as CommunitiesService,
    communities,
    members,
    chatMembers,
    transactionOptions: [],
    // Nullish coalescing would turn a deliberate null back into true, which
    // is how the missing-user case silently passed the first time.
    goldenTick: 'goldenTick' in options ? (options.goldenTick ?? null) : true,
    lastListWhere: null,
  };

  let queue: Promise<unknown> = Promise.resolve();
  const withOwner = (row: CommunityRow): unknown => ({
    ...row,
    users: {
      name: 'Ada',
      username: 'ada',
      profilePicture: null,
      blueTick: false,
      goldenTick: true,
    },
  });

  const db = {
    community: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
        const row = communities.get(where.id);
        return Promise.resolve(row === undefined ? null : withOwner(row));
      },
      findFirst: ({
        where,
      }: {
        where: { name?: string };
      }): Promise<unknown> => {
        const row = [...communities.values()].find(
          (entry) => entry.name === where.name,
        );
        return Promise.resolve(row === undefined ? null : withOwner(row));
      },
      findMany: (args: { where: unknown }): Promise<readonly unknown[]> => {
        harness.lastListWhere = args.where;
        return Promise.resolve([...communities.values()].map(withOwner));
      },
      count: (args: { where: unknown }): Promise<number> => {
        harness.lastListWhere = args.where;
        return Promise.resolve(communities.size);
      },
      create: ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = makeCommunity({
          id: `community-${String(communities.size + 1)}`,
          name: String(data.name),
          description:
            typeof data.description === 'string' ? data.description : null,
          ownerId: typeof data.ownerId === 'string' ? data.ownerId : null,
          isPrivate: data.isPrivate === true,
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          memberCount:
            typeof data.memberCount === 'number' ? data.memberCount : 1,
        });
        communities.set(row.id, row);
        return Promise.resolve(withOwner(row));
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = communities.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing'));
        const increment =
          typeof data.memberCount === 'object' && data.memberCount !== null
            ? Number(Reflect.get(data.memberCount, 'increment') ?? 0)
            : null;
        const next: CommunityRow = {
          ...row,
          name: typeof data.name === 'string' ? data.name : row.name,
          description:
            typeof data.description === 'string'
              ? data.description
              : row.description,
          isPrivate:
            typeof data.isPrivate === 'boolean'
              ? data.isPrivate
              : row.isPrivate,
          isActive:
            typeof data.isActive === 'boolean' ? data.isActive : row.isActive,
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : row.tags,
          settings: data.settings ?? row.settings,
          memberCount:
            increment !== null
              ? row.memberCount + increment
              : typeof data.memberCount === 'number'
                ? data.memberCount
                : row.memberCount,
        };
        communities.set(next.id, next);
        return Promise.resolve(withOwner(next));
      },
    },
    communityMember: {
      findUnique: ({
        where,
      }: {
        where: { communityId_userId: { communityId: string; userId: string } };
      }): Promise<unknown> => {
        const { communityId, userId } = where.communityId_userId;
        return Promise.resolve(
          members.find(
            (m) => key(m.communityId, m.userId) === key(communityId, userId),
          ) ?? null,
        );
      },
      findMany: ({
        where,
      }: {
        where: { communityId: string; role?: string };
      }): Promise<readonly unknown[]> =>
        Promise.resolve(
          members
            .filter(
              (m) =>
                m.communityId === where.communityId &&
                (where.role === undefined || m.role === where.role),
            )
            .map((m) => ({
              ...m,
              user: {
                name: m.userId,
                username: m.userId,
                profilePicture: null,
              },
            })),
        ),
      create: ({ data }: { data: MemberRow }): Promise<unknown> => {
        const exists = members.some(
          (m) =>
            key(m.communityId, m.userId) === key(data.communityId, data.userId),
        );
        if (exists) return Promise.reject(new UniqueViolation());
        members.push({ ...data });
        return Promise.resolve(data);
      },
      deleteMany: ({
        where,
      }: {
        where: { communityId: string; userId?: string };
      }): Promise<{ count: number }> => {
        const before = members.length;
        for (let i = members.length - 1; i >= 0; i -= 1) {
          const m = members[i];
          if (
            m !== undefined &&
            m.communityId === where.communityId &&
            (where.userId === undefined || m.userId === where.userId)
          ) {
            members.splice(i, 1);
          }
        }
        return Promise.resolve({ count: before - members.length });
      },
    },
    chat: {
      findFirst: (): Promise<unknown> => Promise.resolve({ id: 'chat-1' }),
      create: (): Promise<unknown> => Promise.resolve({ id: 'chat-1' }),
    },
    chatMember: {
      create: ({
        data,
      }: {
        data: { chatId: string; userId: string };
      }): Promise<unknown> => {
        chatMembers.push(data);
        return Promise.resolve(data);
      },
      deleteMany: ({
        where,
      }: {
        where: { chatId: string; userId?: string };
      }): Promise<{ count: number }> => {
        const before = chatMembers.length;
        for (let i = chatMembers.length - 1; i >= 0; i -= 1) {
          const m = chatMembers[i];
          if (
            m !== undefined &&
            m.chatId === where.chatId &&
            (where.userId === undefined || m.userId === where.userId)
          ) {
            chatMembers.splice(i, 1);
          }
        }
        return Promise.resolve({ count: before - chatMembers.length });
      },
    },
    user: {
      findUnique: (): Promise<unknown> =>
        Promise.resolve(
          harness.goldenTick === null
            ? null
            : { goldenTick: harness.goldenTick },
        ),
    },
    $transaction: (operation: unknown, opts: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        if (opts !== undefined) harness.transactionOptions.push(opts);
        if (typeof operation !== 'function') {
          throw new Error('expected callback');
        }
        return Reflect.apply(operation, undefined, [db]) as unknown;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  return Object.assign(harness, {
    service: new CommunitiesService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

describe('community creation', () => {
  it('creates a community owned by the caller', async () => {
    const harness = createHarness({ communities: [] });
    const result = await harness.service.create(owner, {
      name: 'Makers',
      description: 'A community for makers of things.',
    });

    expect(result.data.name).toBe('Makers');
    expect(result.data.memberCount).toBe(1);
    // Legacy answered with both id and a Mongo-era _id alias.
    expect(result.data._id).toBe(result.data.id);
  });

  it('refuses a caller without a golden tick', async () => {
    const harness = createHarness({ communities: [], goldenTick: false });
    await expect(
      harness.service.create(owner, {
        name: 'Makers',
        description: 'A community for makers of things.',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('reports a missing user rather than answering 500', async () => {
    const harness = createHarness({ communities: [], goldenTick: null });
    await expect(
      harness.service.create(owner, {
        name: 'Makers',
        description: 'A community for makers of things.',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a duplicate name', async () => {
    const harness = createHarness();
    await expect(
      harness.service.create(owner, {
        name: 'Builders',
        description: 'A community for people who build.',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('community listing', () => {
  it('omits the search filter entirely when no term is given', async () => {
    const harness = createHarness();
    await harness.service.list({});
    // Legacy defaulted the term to '' and still ran three contains predicates.
    expect(harness.lastListWhere).toEqual({ isActive: true });
  });

  it('applies the filter when a term is given', async () => {
    const harness = createHarness();
    await harness.service.list({ search: 'build' });
    expect(harness.lastListWhere).toMatchObject({
      isActive: true,
      OR: expect.anything() as unknown,
    });
  });
});

describe('community join', () => {
  it('joins a public community and counts the member once', async () => {
    const harness = createHarness();
    const result = await harness.service.join(joiner, 'community-1');

    expect(result.message).toBe('Successfully joined the community');
    expect(harness.communities.get('community-1')?.memberCount).toBe(2);
    expect(harness.members).toHaveLength(1);
    expect(harness.chatMembers).toEqual([
      { chatId: 'chat-1', userId: 'joiner' },
    ]);
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('does not double count a racing double join', async () => {
    const harness = createHarness();
    // The unique constraint decides, so only one of these creates a row.
    await Promise.all([
      harness.service.join(joiner, 'community-1').catch(() => undefined),
      harness.service.join(joiner, 'community-1').catch(() => undefined),
    ]);

    expect(harness.members).toHaveLength(1);
    expect(harness.communities.get('community-1')?.memberCount).toBe(2);
  });

  it('holds a private community join as pending', async () => {
    const harness = createHarness({
      communities: [makeCommunity({ isPrivate: true })],
    });
    const result = await harness.service.join(joiner, 'community-1');

    expect(result).toMatchObject({ requiresApproval: true });
    expect(harness.members[0]?.status).toBe('pending');
    // A pending member is not counted and is not added to the chat.
    expect(harness.communities.get('community-1')?.memberCount).toBe(1);
    expect(harness.chatMembers).toHaveLength(0);
  });

  it('demands payment for a paid community, with the price attached', async () => {
    const harness = createHarness({
      communities: [
        makeCommunity({
          settings: {
            payment: {
              isPaidCommunity: true,
              price: 25,
              currency: 'USD',
              subscriptionType: 'monthly',
              paymentMethods: ['paystack'],
            },
          },
        }),
      ],
    });

    await expect(
      harness.service.join(joiner, 'community-1'),
    ).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      details: {
        requiresPayment: true,
        paymentInfo: { price: 25, currency: 'USD' },
      },
    });
    expect(harness.members).toHaveLength(0);
  });

  it('refuses a banned or already-active member', async () => {
    const banned = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'joiner',
          role: 'member',
          status: 'banned',
        },
      ],
    });
    await expect(
      banned.service.join(joiner, 'community-1'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    const active = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'joiner',
          role: 'member',
          status: 'active',
        },
      ],
    });
    await expect(
      active.service.join(joiner, 'community-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('community leave', () => {
  it('removes an active member and decrements the count', async () => {
    const harness = createHarness({
      communities: [makeCommunity({ memberCount: 2 })],
      members: [
        {
          communityId: 'community-1',
          userId: 'joiner',
          role: 'member',
          status: 'active',
        },
      ],
    });
    harness.chatMembers.push({ chatId: 'chat-1', userId: 'joiner' });

    await expect(
      harness.service.leave(joiner, 'community-1'),
    ).resolves.toMatchObject({ success: true });
    expect(harness.members).toHaveLength(0);
    expect(harness.communities.get('community-1')?.memberCount).toBe(1);
    expect(harness.chatMembers).toHaveLength(0);
  });

  it('does not decrement for a pending member', async () => {
    const harness = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'joiner',
          role: 'member',
          status: 'pending',
        },
      ],
    });
    await harness.service.leave(joiner, 'community-1');
    expect(harness.communities.get('community-1')?.memberCount).toBe(1);
  });

  it('refuses the owner and a non-member', async () => {
    const harness = createHarness();
    await expect(
      harness.service.leave(owner, 'community-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      harness.service.leave(joiner, 'community-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('community update and delete', () => {
  it('merges settings rather than replacing them', async () => {
    const harness = createHarness({
      communities: [
        makeCommunity({ settings: { requireApproval: true, theme: 'dark' } }),
      ],
    });

    await harness.service.update(owner, 'community-1', {
      settings: { theme: 'light' },
    });

    expect(harness.communities.get('community-1')?.settings).toEqual({
      requireApproval: true,
      theme: 'light',
    });
  });

  it('lets a moderator update but refuses a plain member', async () => {
    const moderator = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'joiner',
          role: 'moderator',
          status: 'active',
        },
      ],
    });
    await expect(
      moderator.service.update(joiner, 'community-1', { name: 'Renamed' }),
    ).resolves.toMatchObject({ success: true });

    const plain = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'joiner',
          role: 'member',
          status: 'active',
        },
      ],
    });
    await expect(
      plain.service.update(joiner, 'community-1', { name: 'Renamed' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('soft deletes, clears members and zeroes the count', async () => {
    const harness = createHarness({
      communities: [makeCommunity({ memberCount: 7 })],
      members: [
        {
          communityId: 'community-1',
          userId: 'joiner',
          role: 'member',
          status: 'active',
        },
      ],
    });
    harness.chatMembers.push({ chatId: 'chat-1', userId: 'joiner' });

    await harness.service.remove(owner, 'community-1');

    const row = harness.communities.get('community-1');
    expect(row?.isActive).toBe(false);
    expect(harness.members).toHaveLength(0);
    // Legacy cleared the member rows but left the count, so a reactivated
    // community reported members that no longer existed.
    expect(row?.memberCount).toBe(0);
    expect(harness.chatMembers).toHaveLength(0);
  });

  it('refuses deletion by anyone but the owner', async () => {
    const harness = createHarness();
    await expect(
      harness.service.remove(joiner, 'community-1'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });
});

describe('community routes', () => {
  const reflector = new Reflector();
  const handlerOf = (name: string) => {
    const handler: unknown = Reflect.get(CommunitiesController.prototype, name);
    if (typeof handler !== 'function') {
      throw new Error(`CommunitiesController.${name} is missing`);
    }
    return handler;
  };

  it('registers the exact eight legacy routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, CommunitiesController)).toBe(
      'api/communities',
    );

    const routes = [
      ['create', '/', RequestMethod.POST],
      ['list', '/', RequestMethod.GET],
      ['listMine', 'my', RequestMethod.GET],
      ['get', ':id', RequestMethod.GET],
      ['join', ':id/join', RequestMethod.POST],
      ['leave', ':id/leave', RequestMethod.POST],
      ['update', ':id', RequestMethod.PUT],
      ['remove', ':id', RequestMethod.DELETE],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('keeps the legacy guard stack, including both second factors', () => {
    for (const name of ['create', 'remove']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toEqual([SessionGuard, TwoFactorGuard]);
    }
    for (const name of ['listMine', 'get', 'join', 'leave', 'update']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toEqual([SessionGuard]);
    }
    // The public listing stays public.
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('list')),
    ).toBeUndefined();
  });

  it('declares the literal my route before the id route', () => {
    const names = Object.getOwnPropertyNames(CommunitiesController.prototype);
    expect(names.indexOf('listMine')).toBeLessThan(names.indexOf('get'));
  });
});
