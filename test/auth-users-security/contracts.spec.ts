import { DomainError } from '../../src/common/errors/domain.error';
import {
  createPageMeta,
  parsePageQuery,
} from '../../src/common/pagination/page-query';
import {
  projectUserProfile,
  type UserProfileSource,
} from '../../src/profiles/profile.contract';
import {
  parseFollowRequestStatus,
  parsePrivacySettings,
} from '../../src/security/security.contract';
import {
  parseUserSearch,
  projectUser,
  type UserProjectionSource,
} from '../../src/users/user.contract';

const baseUser = {
  id: 'user-1',
  username: 'ada',
  name: 'Ada Lovelace',
  image: null,
  avatar: null,
  profilePicture: null,
  coverPicture: null,
  bio: null,
  location: null,
  blueTick: true,
  goldenTick: false,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
} satisfies UserProjectionSource;

const profileUser = {
  ...baseUser,
  email: 'ada@example.com',
  emailVerified: true,
  subscriptionStatus: 'active',
  subscriptionExpiry: null,
  walletAddress: null,
  twoFactorEnabled: null,
  updatedAt: new Date('2026-08-02T10:00:00.000Z'),
  lastLoginAt: null,
  postsCount: 0,
  bookmarksCount: 0,
} satisfies UserProfileSource;

describe('auth users security contracts', () => {
  describe('pagination', () => {
    it('defaults absent pagination and clamps out-of-range numeric values', () => {
      expect(parsePageQuery({})).toEqual({ page: 1, limit: 20 });
      expect(parsePageQuery({ page: '0', limit: '500' })).toEqual({
        page: 1,
        limit: 100,
      });
    });

    it('rejects malformed pagination with a domain validation error', () => {
      expect(() => parsePageQuery({ page: 'many' })).toThrow(DomainError);
      expect(() => parsePageQuery({ page: 'many' })).toThrow('page');
    });

    it('creates fully defined page metadata including an empty result', () => {
      expect(createPageMeta({ page: 2, limit: 20 }, 41)).toEqual({
        page: 2,
        limit: 20,
        total: 41,
        pages: 3,
      });
      expect(createPageMeta({ page: 1, limit: 20 }, 0).pages).toBe(0);
    });

    it('composes pagination and search parsing over one query object', () => {
      const query = { page: '2', limit: '10', search: '  Ada  ' };

      expect(parsePageQuery(query)).toEqual({ page: 2, limit: 10 });
      expect(parseUserSearch(query)).toEqual({ search: 'Ada' });
    });
  });

  describe('user requests and projections', () => {
    it('normalizes search text and defaults an absent search', () => {
      expect(parseUserSearch({ search: '  Ada  ' })).toEqual({ search: 'Ada' });
      expect(parseUserSearch({})).toEqual({ search: '' });
    });

    it('projects nullable Prisma user fields to explicit nulls', () => {
      const user = projectUser(baseUser);

      expect(user).toEqual({
        id: 'user-1',
        username: 'ada',
        name: 'Ada Lovelace',
        image: null,
        avatar: null,
        profilePicture: null,
        coverPicture: null,
        bio: null,
        location: null,
        blueTick: true,
        goldenTick: false,
        createdAt: '2026-08-01T10:00:00.000Z',
      });
      expect(Object.values(user).some((value) => value === undefined)).toBe(
        false,
      );
      expect(user).not.toHaveProperty('email');
      expect(user).not.toHaveProperty('sessions');
      expect(user).not.toHaveProperty('accounts');
    });

    it('projects a current-user profile without raw auth records', () => {
      const profile = projectUserProfile(profileUser);

      expect(profile).toMatchObject({
        email: 'ada@example.com',
        emailVerified: true,
        subscriptionExpiry: null,
        walletAddress: null,
        twoFactorEnabled: false,
        lastLoginAt: null,
      });
      expect(Object.values(profile).some((value) => value === undefined)).toBe(
        false,
      );
      expect(profile).not.toHaveProperty('password');
      expect(profile).not.toHaveProperty('sessions');
      expect(profile).not.toHaveProperty('accounts');
      expect(profile).not.toHaveProperty('twofactors');
    });
  });

  describe('privacy and follow requests', () => {
    it('fills absent persisted privacy keys with safe explicit defaults', () => {
      expect(parsePrivacySettings({})).toEqual({
        isPrivate: false,
        allowFollowRequests: true,
        showOnlineStatus: true,
        allowDirectMessages: 'everyone',
        allowComments: true,
        allowTags: true,
      });
      expect(parsePrivacySettings(null)).toEqual({
        isPrivate: false,
        allowFollowRequests: true,
        showOnlineStatus: true,
        allowDirectMessages: 'everyone',
        allowComments: true,
        allowTags: true,
      });
    });

    it('rejects unsupported profile visibility with field context', () => {
      expect(() =>
        parsePrivacySettings({ allowDirectMessages: 'friends' }),
      ).toThrow(DomainError);
      expect(() =>
        parsePrivacySettings({ allowDirectMessages: 'friends' }),
      ).toThrow('allowDirectMessages');
    });

    it('rejects unexpected privacy fields instead of silently accepting them', () => {
      expect(() =>
        parsePrivacySettings({
          isPrivate: false,
          allowFollowRequests: true,
          showOnlineStatus: true,
          allowDirectMessages: 'everyone',
          allowComments: true,
          allowTags: true,
          isAdmin: true,
        }),
      ).toThrow(DomainError);
    });

    it('accepts only declared follow-request states', () => {
      expect(parseFollowRequestStatus('approved')).toBe('approved');
      expect(() => parseFollowRequestStatus('cancelled')).toThrow(DomainError);
      expect(() => parseFollowRequestStatus('cancelled')).toThrow('status');
    });
  });
});
