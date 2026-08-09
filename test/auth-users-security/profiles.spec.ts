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
import { DomainError } from '../../src/common/errors/domain.error';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { ProfilesController } from '../../src/profiles/profiles.controller';
import { ProfilesService } from '../../src/profiles/profiles.service';

const principal: AuthenticatedPrincipal = Object.freeze({
  userId: 'user-1',
  email: 'ada@example.com',
  username: 'ada',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-1',
});

const profileRecord = Object.freeze({
  id: 'user-1',
  username: 'ada',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  image: null,
  avatar: null,
  profilePicture: null,
  coverPicture: null,
  bio: null,
  location: null,
  blueTick: true,
  goldenTick: false,
  subscriptionStatus: 'active',
  subscriptionExpiry: null,
  walletAddress: null,
  twoFactorEnabled: null,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-02T10:00:00.000Z'),
  lastLoginAt: null,
  followers: ['follower-1', 'follower-2'],
  _count: Object.freeze({ posts_posts_userIdTousers: 2, bookmarks: 3 }),
});

let settingsResult: unknown = null;
let profileResult: unknown = profileRecord;
let updateError: Error | undefined;
let capturedUpdate: unknown;

const readId = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return '';
  const where: unknown = Reflect.get(input, 'where');
  if (typeof where !== 'object' || where === null) return '';
  const id: unknown = Reflect.get(where, 'id');
  return typeof id === 'string' ? id : '';
};

const readData = (input: unknown): unknown =>
  typeof input === 'object' && input !== null
    ? Reflect.get(input, 'data')
    : undefined;

const fakeClient = {
  $connect: (): Promise<void> => Promise.resolve(),
  $disconnect: (): Promise<void> => Promise.resolve(),
  $queryRaw: (): Promise<unknown> => Promise.resolve(1),
  user: {
    findUnique: (input: unknown): Promise<unknown> =>
      Promise.resolve(readId(input) === 'user-1' ? profileResult : null),
    update: (input: unknown): Promise<unknown> => {
      capturedUpdate = input;
      if (updateError) return Promise.reject(updateError);
      return Promise.resolve({ ...profileRecord, username: 'analytical-ada' });
    },
  },
  post: {
    findMany: (): Promise<unknown> =>
      Promise.resolve([
        {
          id: 'post-1',
          type: 'text',
          createdAt: new Date('2026-08-04T10:00:00.000Z'),
          text: 'A post',
          media: null,
        },
      ]),
  },
  comment: {
    findMany: (): Promise<unknown> =>
      Promise.resolve([
        {
          id: 'comment-1',
          text: 'A comment',
          createdAt: new Date('2026-08-03T10:00:00.000Z'),
          postId: 'post-1',
        },
      ]),
  },
  securityEvent: {
    findMany: (): Promise<unknown> =>
      Promise.resolve([
        {
          id: 'security-1',
          eventType: 'LOGIN',
          timestamp: new Date('2026-08-05T10:00:00.000Z'),
          ipAddress: '127.0.0.1',
        },
      ]),
  },
  verificationSettings: {
    findFirst: (): Promise<unknown> => Promise.resolve(settingsResult),
  },
};

const createService = (): ProfilesService =>
  new ProfilesService(new PrismaService(fakeClient));

describe('profile endpoints', () => {
  const reflector = new Reflector();

  beforeEach(() => {
    settingsResult = null;
    profileResult = profileRecord;
    updateError = undefined;
    capturedUpdate = undefined;
  });

  it('registers the ten non-auth profile and social routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, ProfilesController)).toBe(
      'api/profile',
    );
    const routes = Object.getOwnPropertyNames(ProfilesController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler: unknown = Reflect.get(
          ProfilesController.prototype,
          name,
        );
        return {
          method:
            typeof handler === 'function'
              ? reflector.get<unknown>(METHOD_METADATA, handler)
              : undefined,
          path:
            typeof handler === 'function'
              ? reflector.get<unknown>(PATH_METADATA, handler)
              : undefined,
        };
      });

    expect(routes).toEqual(
      expect.arrayContaining([
        { method: RequestMethod.GET, path: '/' },
        { method: RequestMethod.GET, path: 'activity' },
        { method: RequestMethod.PUT, path: 'update' },
        { method: RequestMethod.GET, path: 'eligibility' },
        { method: RequestMethod.POST, path: 'verify' },
        { method: RequestMethod.GET, path: 'followers' },
        { method: RequestMethod.GET, path: 'following' },
        { method: RequestMethod.GET, path: 'followers/search' },
        { method: RequestMethod.PUT, path: 'follow/:id' },
        { method: RequestMethod.PUT, path: 'unfollow/:id' },
      ]),
    );
    expect(routes).toHaveLength(10);
    expect(routes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'change-password' }),
        expect.objectContaining({ path: 'delete-account' }),
      ]),
    );
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, ProfilesController),
    ).toContain(SessionGuard);
    const updateHandler: unknown = Reflect.get(
      ProfilesController.prototype,
      'update',
    );
    expect(typeof updateHandler).toBe('function');
    if (typeof updateHandler !== 'function') {
      throw new Error('ProfilesController.update is missing.');
    }
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, updateHandler),
    ).toContain(TwoFactorGuard);
  });

  it('projects the current profile with explicit nulls and legacy counts', async () => {
    const result = await createService().getProfile(principal.userId);

    expect(result).toMatchObject({
      id: 'user-1',
      email: 'ada@example.com',
      profilePicture: null,
      subscriptionExpiry: null,
      twoFactorEnabled: false,
      postsCount: 2,
      bookmarksCount: 3,
    });
    expect(Object.values(result).some((value) => value === undefined)).toBe(
      false,
    );
    expect(result).not.toHaveProperty('followers');
    expect(result).not.toHaveProperty('_count');
    expect(result).not.toHaveProperty('password');
  });

  it('updates only username, bio, and location', async () => {
    await expect(
      createService().updateProfile(principal.userId, {
        username: ' analytical-ada ',
        bio: null,
        location: ' Lagos ',
      }),
    ).resolves.toMatchObject({ username: 'analytical-ada', bio: null });
    expect(capturedUpdate).toMatchObject({
      where: { id: 'user-1' },
      data: { username: 'analytical-ada', bio: null, location: 'Lagos' },
    });
    expect(JSON.stringify(readData(capturedUpdate))).not.toContain('email');
  });

  it('rejects email mutation, unknown fields, and empty updates clearly', async () => {
    await expect(
      createService().updateProfile(principal.userId, {
        email: 'new@example.com',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      createService().updateProfile(principal.userId, {
        email: 'new@example.com',
      }),
    ).rejects.toThrow('/api/auth/change-email');
    await expect(
      createService().updateProfile(principal.userId, { isAdmin: true }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      createService().updateProfile(principal.userId, {}),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('maps duplicate usernames and missing records to stable domain errors', async () => {
    updateError = new FixturePrismaError('P2002');
    await expect(
      createService().updateProfile(principal.userId, { username: 'taken' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    updateError = new FixturePrismaError('P2025');
    await expect(
      createService().updateProfile(principal.userId, { username: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('sorts the combined activity feed and paginates after aggregation', async () => {
    await expect(
      createService().getActivity(principal.userId, { page: 1, limit: 2 }),
    ).resolves.toEqual({
      activities: [
        expect.objectContaining({ id: 'security-1', type: 'SECURITY_EVENT' }),
        expect.objectContaining({ id: 'post-1', type: 'POST_CREATED' }),
      ],
      pagination: { page: 1, limit: 2, hasMore: true },
    });
  });

  it('uses exact eligibility defaults and real follower/post counts', async () => {
    await expect(
      createService().getEligibility(principal.userId),
    ).resolves.toEqual({
      eligible: false,
      criteria: {
        followers: { met: false, current: 2, required: 1000 },
        posts: { met: false, current: 2, required: 10 },
        profilePicture: { met: false, required: true },
        coverPicture: { met: false, required: true },
        bio: { met: false, required: true },
      },
    });
  });

  it('rejects malformed persisted follower data instead of reporting zero', async () => {
    profileResult = { ...profileRecord, followers: { malformed: true } };

    await expect(
      createService().getEligibility(principal.userId),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('honors persisted eligibility settings', async () => {
    settingsResult = {
      minFollowers: 2,
      minPosts: 2,
      requiresProfilePic: false,
      requiresCoverPic: false,
      requiresBio: false,
      autoApprove: false,
    };

    await expect(
      createService().getEligibility(principal.userId),
    ).resolves.toMatchObject({
      eligible: true,
      criteria: {
        followers: { met: true, current: 2, required: 2 },
        posts: { met: true, current: 2, required: 2 },
      },
    });
  });
});

class FixturePrismaError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
