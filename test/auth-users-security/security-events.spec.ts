import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { RoleGuard } from '../../src/auth/guards/role/role.guard';
import { TwoFactorGuard } from '../../src/auth/guards/two-factor/two-factor.guard';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { parseRequestAuditContext } from '../../src/common/http/request-audit/request-audit.decorator';
import { ProfilesController } from '../../src/profiles/profiles.controller';
import {
  parseSecurityEventQuery,
  parseSecurityStatsDays,
  parseVerificationTarget,
} from '../../src/security/security.contract';
import { SecurityEventService } from '../../src/security/security-event.service';
import { SecurityService } from '../../src/security/security.service';

const admin: AuthenticatedPrincipal = Object.freeze({
  userId: 'admin',
  email: 'admin@example.test',
  username: 'admin',
  isAdmin: true,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-admin',
});

const member: AuthenticatedPrincipal = Object.freeze({
  ...admin,
  userId: 'member',
  email: 'member@example.test',
  username: 'member',
  isAdmin: false,
  sessionId: 'session-member',
});

const events: object[] = [];
let verified = false;
let eligible = true;
let providerFailure = false;

const client = {
  $connect: (): Promise<void> => Promise.resolve(),
  $disconnect: (): Promise<void> => Promise.resolve(),
  $queryRaw: (): Promise<unknown> => Promise.resolve(1),
  $transaction: (operation: unknown): Promise<unknown> =>
    typeof operation === 'function'
      ? Promise.resolve(Reflect.apply(operation, client, [client]))
      : Promise.reject(new Error('callback required')),
  user: {
    findUnique: (input: unknown): Promise<object | null> => {
      const id = readWhereId(input);
      if (!['admin', 'member', 'target'].includes(id))
        return Promise.resolve(null);
      return Promise.resolve({
        id,
        username: id,
        name: id,
        image: null,
        avatar: null,
        profilePicture: 'https://media.example/profile.png',
        coverPicture: 'https://media.example/cover.png',
        bio: 'complete',
        location: null,
        blueTick: verified,
        goldenTick: false,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        blockedUsers: [],
        privacy: null,
        followRequests: [],
        followers: eligible
          ? Array.from({ length: 1000 }, (_, index) => `f-${index}`)
          : [],
        following: [],
        _count: { posts_posts_userIdTousers: eligible ? 10 : 0 },
      });
    },
    update: (): Promise<object> => {
      verified = true;
      return Promise.resolve({ id: 'target', blueTick: true });
    },
    findMany: (): Promise<readonly object[]> => Promise.resolve([]),
  },
  verificationSettings: {
    findFirst: (): Promise<object> =>
      Promise.resolve({
        minFollowers: 1000,
        minPosts: 10,
        requiresProfilePic: true,
        requiresCoverPic: true,
        requiresBio: true,
        autoApprove: true,
      }),
  },
  securityEvent: {
    create: (input: unknown): Promise<object> => {
      if (providerFailure)
        return Promise.reject(new Error('raw database secret'));
      const data = readObjectProperty(input, 'data');
      const stored = {
        id: `event-${events.length + 1}`,
        ...data,
        timestamp: new Date('2026-08-09T12:00:00.000Z'),
      };
      events.push(stored);
      return Promise.resolve(stored);
    },
    findMany: (): Promise<readonly object[]> =>
      providerFailure
        ? Promise.reject(new Error('raw database secret'))
        : Promise.resolve([
            {
              id: 'event-public',
              eventType: 'verification',
              targetUserId: 'target',
              metadata: {
                outcome: 'verified',
                token: 'raw-secret',
                nested: { password: 'raw-secret' },
              },
              ipAddress: '127.0.0.1',
              userAgent: 'Jest',
              timestamp: new Date('2026-08-09T12:00:00.000Z'),
              success: true,
              errorMessage: 'raw-secret',
            },
          ]),
    count: (): Promise<number> => Promise.resolve(1),
    groupBy: (): Promise<readonly object[]> =>
      Promise.resolve([
        {
          eventType: 'verification',
          _count: { _all: 2 },
          _max: { timestamp: new Date('2026-08-09T12:00:00.000Z') },
        },
      ]),
  },
};

const readObjectProperty = (value: unknown, key: string): object => {
  if (typeof value !== 'object' || value === null) return {};
  const property: unknown = Reflect.get(value, key);
  return typeof property === 'object' && property !== null ? property : {};
};

const readWhereId = (value: unknown): string => {
  const where = readObjectProperty(value, 'where');
  const id: unknown = Reflect.get(where, 'id');
  return typeof id === 'string' ? id : '';
};

const route = (
  name: string,
): { readonly method: unknown; readonly path: unknown } => {
  const handler: unknown = Reflect.get(ProfilesController.prototype, name);
  return typeof handler === 'function'
    ? {
        method: Reflect.getMetadata(METHOD_METADATA, handler),
        path: Reflect.getMetadata(PATH_METADATA, handler),
      }
    : { method: undefined, path: undefined };
};

describe('security events and verification migration', () => {
  beforeEach(() => {
    events.length = 0;
    verified = false;
    eligible = true;
    providerFailure = false;
  });

  it('parses bounded event and statistics queries', () => {
    expect(parseSecurityEventQuery({ page: '0', limit: '500' })).toEqual({
      page: 1,
      limit: 100,
      eventType: null,
      startDate: null,
      endDate: null,
    });
    expect(parseSecurityStatsDays('0')).toBe(1);
    expect(parseSecurityStatsDays('900')).toBe(365);
    expect(() =>
      parseSecurityEventQuery({
        startDate: '2026-08-10T00:00:00.000Z',
        endDate: '2026-08-09T00:00:00.000Z',
      }),
    ).toThrow('date range');
    expect(() =>
      parseVerificationTarget({ userId: 'target', force: true }),
    ).toThrow('verification request');
  });

  it('normalizes request audit context without trusting arbitrary values', () => {
    expect(
      parseRequestAuditContext({
        ip: ' 127.0.0.1 ',
        headers: { 'user-agent': ' Jest Agent ' },
      }),
    ).toEqual({ ipAddress: '127.0.0.1', userAgent: 'Jest Agent' });
    expect(parseRequestAuditContext({ ip: 42, headers: {} })).toEqual({
      ipAddress: 'unknown',
      userAgent: 'unknown',
    });
  });

  it('registers POST /api/profile/verify without accepting a force route', () => {
    expect(route('verify')).toEqual({
      method: RequestMethod.POST,
      path: 'verify',
    });
    const handler: unknown = Reflect.get(
      ProfilesController.prototype,
      'verify',
    );
    expect(typeof handler).toBe('function');
    if (typeof handler === 'function') {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        RoleGuard,
        TwoFactorGuard,
      ]);
    }
  });

  it('rejects member verification and requires a satisfied 2FA session', async () => {
    const prisma = new PrismaService(client);
    const audit = new SecurityEventService(prisma);
    const security = new SecurityService(prisma, audit);
    await expect(security.verifyUser(member, 'target')).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    await expect(
      security.verifyUser({ ...admin, twoFactorSatisfied: false }, 'target'),
    ).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
  });

  it('calculates eligibility server-side, verifies, and records a sanitized audit event', async () => {
    const prisma = new PrismaService(client);
    const audit = new SecurityEventService(prisma);
    const security = new SecurityService(prisma, audit);
    await expect(
      security.verifyUser(admin, 'target', {
        ipAddress: '127.0.0.1',
        userAgent: 'Jest Agent',
      }),
    ).resolves.toEqual({ verified: true });
    expect(verified).toBe(true);
    expect(JSON.stringify(events)).not.toContain('session-admin');
    expect(events[0]).toMatchObject({
      ipAddress: '127.0.0.1',
      userAgent: 'Jest Agent',
    });
    await audit.record({
      userId: 'admin',
      eventType: 'verification',
      targetUserId: 'target',
      success: false,
      ipAddress: '127.0.0.1',
      userAgent: 'Jest',
      metadata: { token: 'raw-secret', outcome: 'denied' },
      errorMessage: 'raw-secret',
    });
    expect(JSON.stringify(events)).not.toContain('raw-secret');
  });

  it('refuses verification when server-side eligibility is incomplete', async () => {
    eligible = false;
    const prisma = new PrismaService(client);
    const audit = new SecurityEventService(prisma);
    const security = new SecurityService(prisma, audit);
    await expect(security.verifyUser(admin, 'target')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(verified).toBe(false);
  });

  it('returns owner-scoped, newest-first pages without secrets or raw errors', async () => {
    const audit = new SecurityEventService(new PrismaService(client));
    const result = await audit.list(
      'member',
      parseSecurityEventQuery({ page: '1', limit: '20' }),
    );
    expect(result.page).toEqual({ page: 1, limit: 20, total: 1, pages: 1 });
    expect(JSON.stringify(result)).not.toContain('raw-secret');
    expect(result.events[0]).toMatchObject({
      eventType: 'verification',
      success: true,
    });
  });

  it('returns bounded statistics and sanitizes persistence failures', async () => {
    const audit = new SecurityEventService(new PrismaService(client));
    await expect(audit.stats('member', 30)).resolves.toEqual({
      total: 2,
      events: [
        {
          eventType: 'verification',
          count: 2,
          lastOccurrence: '2026-08-09T12:00:00.000Z',
        },
      ],
    });
    providerFailure = true;
    const promise = audit.list(
      'member',
      parseSecurityEventQuery({ page: '1', limit: '20' }),
    );
    await expect(promise).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Security history is temporarily unavailable.',
    });
    await expect(promise).rejects.not.toThrow('raw database secret');
  });
});
