import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { CommunityProfilesController } from '../../src/community-profiles/community-profiles.controller';
import { CommunityProfilesService } from '../../src/community-profiles/community-profiles.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import type {
  UploadImageInput,
  UploadedMedia,
} from '../../src/providers/media/media.port';
import { MediaPort } from '../../src/providers/media/media.port';

const AUTHOR_RELATION = 'users_posts_userIdTouser';
const COMMUNITY_RELATION = 'communities';
const EPOCH = new Date('2026-08-01T00:00:00.000Z');

const owner: AuthenticatedPrincipal = {
  userId: 'owner',
  email: 'owner@example.com',
  username: 'owner',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 'session-owner',
};

const stranger: AuthenticatedPrincipal = { ...owner, userId: 'stranger' };
const moderator: AuthenticatedPrincipal = { ...owner, userId: 'mod' };

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

interface PostRow {
  id: string;
  text: string | null;
  userId: string;
  communityId: string | null;
  media: unknown;
  type: string;
  status: string;
  createdAt: Date;
}

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

class FakeMedia extends MediaPort {
  last: UploadImageInput | null = null;

  uploadProfileImage(input: UploadImageInput): Promise<UploadedMedia> {
    this.last = input;
    return Promise.resolve({
      url: `https://cdn.example.com/${input.purpose}.jpg`,
      providerId: 'asset-1',
    });
  }

  deleteProfileImage(): Promise<void> {
    return Promise.resolve();
  }
}

interface Harness {
  readonly service: CommunityProfilesService;
  readonly media: FakeMedia;
  readonly communities: Map<string, CommunityRow>;
  readonly members: MemberRow[];
  readonly followers: Array<{ communityId: string; userId: string }>;
  readonly posts: PostRow[];
  lastPostWhere: unknown;
  lastInclude: unknown;
}

const createHarness = (
  options: Readonly<{
    communities?: readonly CommunityRow[];
    members?: readonly MemberRow[];
    followers?: ReadonlyArray<{ communityId: string; userId: string }>;
    posts?: readonly PostRow[];
  }> = {},
): Harness => {
  const communities = new Map(
    (options.communities ?? [makeCommunity()]).map((row) => [row.id, row]),
  );
  const members = [...(options.members ?? [])];
  const followers = [...(options.followers ?? [])];
  const posts = [...(options.posts ?? [])];
  const media = new FakeMedia();

  const harness: Harness = {
    service: undefined as unknown as CommunityProfilesService,
    media,
    communities,
    members,
    followers,
    posts,
    lastPostWhere: null,
    lastInclude: null,
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
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = communities.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing'));
        const next: CommunityRow = {
          ...row,
          name: typeof data.name === 'string' ? data.name : row.name,
          description:
            typeof data.description === 'string'
              ? data.description
              : row.description,
          profile: data.profile ?? row.profile,
          settings: data.settings ?? row.settings,
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
            (m) => m.communityId === communityId && m.userId === userId,
          ) ?? null,
        );
      },
      findFirst: ({
        where,
      }: {
        where: { communityId: string; userId: string; role?: unknown };
      }): Promise<unknown> => {
        const roles =
          typeof where.role === 'object' && where.role !== null
            ? (Reflect.get(where.role, 'in') as readonly string[])
            : null;
        return Promise.resolve(
          members.find(
            (m) =>
              m.communityId === where.communityId &&
              m.userId === where.userId &&
              (roles === null || roles.includes(m.role)),
          ) ?? null,
        );
      },
    },
    communityFollower: {
      findUnique: ({
        where,
      }: {
        where: { communityId_userId: { communityId: string; userId: string } };
      }): Promise<unknown> => {
        const { communityId, userId } = where.communityId_userId;
        return Promise.resolve(
          followers.find(
            (f) => f.communityId === communityId && f.userId === userId,
          ) ?? null,
        );
      },
      create: ({
        data,
      }: {
        data: { communityId: string; userId: string };
      }): Promise<unknown> => {
        const exists = followers.some(
          (f) => f.communityId === data.communityId && f.userId === data.userId,
        );
        if (exists) return Promise.reject(new UniqueViolation());
        followers.push(data);
        return Promise.resolve(data);
      },
      deleteMany: ({
        where,
      }: {
        where: { communityId: string; userId: string };
      }): Promise<{ count: number }> => {
        const before = followers.length;
        for (let i = followers.length - 1; i >= 0; i -= 1) {
          const f = followers[i];
          if (
            f !== undefined &&
            f.communityId === where.communityId &&
            f.userId === where.userId
          ) {
            followers.splice(i, 1);
          }
        }
        return Promise.resolve({ count: before - followers.length });
      },
      count: (): Promise<number> => Promise.resolve(followers.length),
    },
    post: {
      create: ({
        data,
        include,
      }: {
        data: Record<string, unknown>;
        include: unknown;
      }): Promise<unknown> => {
        harness.lastInclude = include;
        const row: PostRow = {
          id: `post-${String(posts.length + 1)}`,
          text: typeof data.text === 'string' ? data.text : null,
          userId: String(data.userId),
          communityId:
            typeof data.communityId === 'string' ? data.communityId : null,
          media: data.media ?? [],
          type: String(data.type),
          status: String(data.status),
          createdAt: EPOCH,
        };
        posts.push(row);
        return Promise.resolve(decorate(row));
      },
      findMany: (args: {
        where: unknown;
        include: unknown;
      }): Promise<readonly unknown[]> => {
        harness.lastPostWhere = args.where;
        harness.lastInclude = args.include;
        return Promise.resolve(posts.map(decorate));
      },
      count: (args: { where: unknown }): Promise<number> => {
        harness.lastPostWhere = args.where;
        return Promise.resolve(posts.length);
      },
    },
    $transaction: (operation: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        if (typeof operation !== 'function') {
          throw new Error('expected callback');
        }
        return Reflect.apply(operation, undefined, [db]) as unknown;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  const decorate = (row: PostRow): unknown => ({
    ...row,
    [AUTHOR_RELATION]: {
      name: row.userId,
      username: row.userId,
      profilePicture: null,
      blueTick: false,
      goldenTick: false,
    },
    [COMMUNITY_RELATION]: { name: 'Builders', profile: null },
  });

  return Object.assign(harness, {
    service: new CommunityProfilesService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
      media,
    ),
  });
};

const profileOf = (row: CommunityRow | undefined): Record<string, unknown> =>
  typeof row?.profile === 'object' && row.profile !== null
    ? (row.profile as Record<string, unknown>)
    : {};

describe('community profile', () => {
  it('merges website and location into the profile json', async () => {
    const harness = createHarness({
      communities: [makeCommunity({ profile: { avatar: 'existing.jpg' } })],
    });

    const result = await harness.service.updateProfile(owner, 'community-1', {
      website: 'https://builders.example',
      location: 'Lagos',
    });

    expect(result.data).toEqual({
      avatar: 'existing.jpg',
      website: 'https://builders.example',
      location: 'Lagos',
    });
  });

  it('writes name and description to their columns', async () => {
    const harness = createHarness();
    await harness.service.updateProfile(owner, 'community-1', {
      name: 'Renamed',
      description: 'A brand new description of the community.',
    });

    expect(harness.communities.get('community-1')).toMatchObject({
      name: 'Renamed',
      description: 'A brand new description of the community.',
    });
  });

  it('lets a moderator through and refuses a stranger', async () => {
    // Legacy resolved membership through an `include: { memberships }` relation
    // that exists on neither schema, so this route answered 500 every time.
    const harness = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'mod',
          role: 'moderator',
          status: 'active',
        },
      ],
    });

    await expect(
      harness.service.updateProfile(moderator, 'community-1', {
        location: 'Abuja',
      }),
    ).resolves.toMatchObject({ success: true });

    await expect(
      harness.service.updateProfile(stranger, 'community-1', {
        location: 'Abuja',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });
});

describe('community photo upload', () => {
  const jpeg = { buffer: Buffer.from([1, 2, 3]), mimetype: 'image/jpeg' };

  it('stores an avatar by default and a cover when asked', async () => {
    const harness = createHarness();

    const avatar = await harness.service.uploadPhoto(
      owner,
      'community-1',
      {},
      jpeg,
    );
    expect(harness.media.last?.purpose).toBe('profile');
    expect(profileOf(harness.communities.get('community-1'))).toHaveProperty(
      'avatar',
    );
    expect(avatar.message).toBe('Community avatar updated successfully');

    const cover = await harness.service.uploadPhoto(
      owner,
      'community-1',
      { type: 'cover' },
      jpeg,
    );
    expect(harness.media.last?.purpose).toBe('cover');
    // Legacy stored the cover under `coverPhoto`, not `cover`.
    expect(profileOf(harness.communities.get('community-1'))).toHaveProperty(
      'coverPhoto',
    );
    expect(cover.message).toBe('Community cover updated successfully');
  });

  it('rejects an unknown photo type, a missing file and a bad mime type', async () => {
    const harness = createHarness();

    await expect(
      harness.service.uploadPhoto(
        owner,
        'community-1',
        { type: 'banner' },
        jpeg,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      harness.service.uploadPhoto(owner, 'community-1', {}, undefined),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      harness.service.uploadPhoto(
        owner,
        'community-1',
        {},
        {
          buffer: Buffer.from([1]),
          mimetype: 'application/pdf',
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('community settings', () => {
  it('merges settings and admits only the owner', async () => {
    const harness = createHarness({
      communities: [makeCommunity({ settings: { canPost: true } })],
    });

    const result = await harness.service.updateSettings(owner, 'community-1', {
      settings: { requireApproval: true },
    });
    expect(result.data).toEqual({ canPost: true, requireApproval: true });

    await expect(
      harness.service.updateSettings(stranger, 'community-1', {
        settings: {},
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });
});

describe('community follow', () => {
  it('follows once and refuses a second follow', async () => {
    const harness = createHarness();
    await expect(
      harness.service.follow(stranger, 'community-1'),
    ).resolves.toMatchObject({ success: true });
    expect(harness.followers).toHaveLength(1);

    await expect(
      harness.service.follow(stranger, 'community-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(harness.followers).toHaveLength(1);
  });

  it('refuses a member, who is already inside the community', async () => {
    const harness = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'stranger',
          role: 'member',
          status: 'active',
        },
      ],
    });
    await expect(
      harness.service.follow(stranger, 'community-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('unfollows idempotently, as legacy did', async () => {
    const harness = createHarness({
      followers: [{ communityId: 'community-1', userId: 'stranger' }],
    });
    await expect(
      harness.service.unfollow(stranger, 'community-1'),
    ).resolves.toMatchObject({ success: true });
    expect(harness.followers).toHaveLength(0);

    // Unfollowing what you do not follow still succeeds.
    await expect(
      harness.service.unfollow(stranger, 'community-1'),
    ).resolves.toMatchObject({ success: true });
  });
});

describe('community posts', () => {
  it('creates a post through the real author relation', async () => {
    const harness = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'owner',
          role: 'owner',
          status: 'active',
        },
      ],
    });

    const result = await harness.service.createPost(owner, 'community-1', {
      content: 'Hello everyone',
    });

    expect(result.data.type).toBe('text');
    expect(result.data.user?.username).toBe('owner');
    // Legacy included `user` and `community`, neither of which exists on Post.
    expect(Object.keys(harness.lastInclude ?? {}).sort()).toEqual(
      [AUTHOR_RELATION, COMMUNITY_RELATION].sort(),
    );
  });

  it('infers the post type from the first media entry', async () => {
    const harness = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'owner',
          role: 'owner',
          status: 'active',
        },
      ],
    });

    const video = await harness.service.createPost(owner, 'community-1', {
      content: 'Clip',
      media: ['https://cdn.example.com/a.mp4'],
    });
    expect(video.data.type).toBe('video');

    const image = await harness.service.createPost(owner, 'community-1', {
      content: 'Photo',
      media: ['https://cdn.example.com/a.jpg'],
    });
    expect(image.data.type).toBe('image');
  });

  it('lets a follower post unless membership is required', async () => {
    const open = createHarness({
      followers: [{ communityId: 'community-1', userId: 'stranger' }],
    });
    await expect(
      open.service.createPost(stranger, 'community-1', { content: 'Hi' }),
    ).resolves.toMatchObject({ success: true });

    const membersOnly = createHarness({
      communities: [
        makeCommunity({
          settings: { postSettings: { requireMembershipToPost: true } },
        }),
      ],
      followers: [{ communityId: 'community-1', userId: 'stranger' }],
    });
    await expect(
      membersOnly.service.createPost(stranger, 'community-1', {
        content: 'Hi',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('holds a post for approval when the community asks for it', async () => {
    const harness = createHarness({
      communities: [
        makeCommunity({
          settings: { postSettings: { requireApproval: true } },
        }),
      ],
      members: [
        {
          communityId: 'community-1',
          userId: 'owner',
          role: 'owner',
          status: 'active',
        },
      ],
    });

    const result = await harness.service.createPost(owner, 'community-1', {
      content: 'Pending please',
    });
    expect(result.data.status).toBe('pending');
    expect(result.message).toBe('Post submitted for approval');
  });

  it('refuses posting when the community has disabled it', async () => {
    const harness = createHarness({
      communities: [makeCommunity({ settings: { canPost: false } })],
      members: [
        {
          communityId: 'community-1',
          userId: 'owner',
          role: 'owner',
          status: 'active',
        },
      ],
    });
    await expect(
      harness.service.createPost(owner, 'community-1', { content: 'Hi' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('shows a plain reader active posts and their own pending ones', async () => {
    const harness = createHarness();
    await harness.service.listPosts(stranger, 'community-1', {});

    expect(harness.lastPostWhere).toEqual({
      communityId: 'community-1',
      OR: [{ status: 'active' }, { userId: 'stranger', status: 'pending' }],
    });
  });

  it('shows a moderator every pending post', async () => {
    const harness = createHarness({
      members: [
        {
          communityId: 'community-1',
          userId: 'mod',
          role: 'moderator',
          status: 'active',
        },
      ],
    });
    await harness.service.listPosts(moderator, 'community-1', {});

    expect(harness.lastPostWhere).toMatchObject({
      OR: [
        { status: 'active' },
        { userId: 'mod', status: 'pending' },
        { status: 'pending' },
      ],
    });
  });

  it('keeps a private community private', async () => {
    const harness = createHarness({
      communities: [makeCommunity({ isPrivate: true })],
    });
    await expect(
      harness.service.listPosts(stranger, 'community-1', {}),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    const follower = createHarness({
      communities: [makeCommunity({ isPrivate: true })],
      followers: [{ communityId: 'community-1', userId: 'stranger' }],
    });
    await expect(
      follower.service.listPosts(stranger, 'community-1', {}),
    ).resolves.toMatchObject({ pagination: expect.anything() as unknown });
  });
});

describe('community profile routes', () => {
  const reflector = new Reflector();
  const handlerOf = (name: string) => {
    const handler: unknown = Reflect.get(
      CommunityProfilesController.prototype,
      name,
    );
    if (typeof handler !== 'function') {
      throw new Error(`CommunityProfilesController.${name} is missing`);
    }
    return handler;
  };

  it('registers the exact seven legacy routes behind a session', () => {
    expect(
      reflector.get<unknown>(PATH_METADATA, CommunityProfilesController),
    ).toBe('api/community-profiles');
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        CommunityProfilesController,
      ),
    ).toEqual([SessionGuard]);

    const routes = [
      ['updateProfile', ':id/profile', RequestMethod.PUT],
      ['uploadPhoto', ':id/upload-photo', RequestMethod.POST],
      ['updateSettings', ':id/settings', RequestMethod.PUT],
      ['follow', ':id/follow', RequestMethod.POST],
      ['unfollow', ':id/unfollow', RequestMethod.POST],
      ['createPost', ':id/posts', RequestMethod.POST],
      ['listPosts', ':id/posts', RequestMethod.GET],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });
});
