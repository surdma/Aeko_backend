import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { RoleGuard } from '../../src/auth/guards/role/role.guard';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { TwoFactorGuard } from '../../src/auth/guards/two-factor/two-factor.guard';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { ReportsController } from '../../src/reports/reports.controller';
import { ReportsService } from '../../src/reports/reports.service';

const member: AuthenticatedPrincipal = {
  userId: 'member',
  email: 'member@example.com',
  username: 'member',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-member',
};

const admin: AuthenticatedPrincipal = {
  ...member,
  userId: 'admin',
  username: 'admin',
  isAdmin: true,
};

const adminWithoutTwoFactor: AuthenticatedPrincipal = {
  ...admin,
  twoFactorSatisfied: false,
};

interface UserRow {
  id: string;
  username: string;
  email: string;
  warningCount: number;
  banned: boolean;
}

interface Harness {
  readonly service: ReportsService;
  readonly users: Map<string, UserRow>;
  readonly notifications: unknown[];
  createdReport: unknown;
  lastReportWhere: unknown;
  lastFindManyArgs: unknown;
  notificationFails: boolean;
}

const createHarness = (): Harness => {
  const users = new Map<string, UserRow>([
    [
      'target',
      {
        id: 'target',
        username: 'target',
        email: 'target@example.com',
        warningCount: 1,
        banned: false,
      },
    ],
    [
      'already-banned',
      {
        id: 'already-banned',
        username: 'banned',
        email: 'banned@example.com',
        warningCount: 0,
        banned: true,
      },
    ],
  ]);

  const harness: Harness = {
    service: undefined as unknown as ReportsService,
    users,
    notifications: [],
    createdReport: null,
    lastReportWhere: null,
    lastFindManyArgs: null,
    notificationFails: false,
  };

  const reportRow = (id: string, status: string): unknown => ({
    id,
    reporterId: 'member',
    reportedId: 'target',
    entityId: 'post-1',
    entityType: 'POST',
    reason: 'Spam',
    status,
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    reporter: { id: 'member', username: 'member', email: 'member@x' },
    reported: {
      id: 'target',
      username: 'target',
      email: 'target@x',
      warningCount: 1,
      banned: false,
    },
  });

  const db = {
    report: {
      create: ({ data }: { data: unknown }): Promise<unknown> => {
        harness.createdReport = data;
        return Promise.resolve(reportRow('report-new', 'pending'));
      },
      findMany: (args: { where: unknown }): Promise<readonly unknown[]> => {
        harness.lastFindManyArgs = args;
        harness.lastReportWhere = args.where;
        return Promise.resolve([reportRow('report-1', 'pending')]);
      },
      count: (): Promise<number> => Promise.resolve(1),
    },
    user: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(users.get(where.id) ?? null),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = users.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing user'));
        if (data.banned === true) users.set(row.id, { ...row, banned: true });
        if (data.warningCount !== undefined) {
          users.set(row.id, { ...row, warningCount: row.warningCount + 1 });
        }
        return Promise.resolve({
          warningCount: users.get(row.id)?.warningCount ?? 0,
        });
      },
    },
    notification: {
      create: ({ data }: { data: unknown }): Promise<unknown> => {
        if (harness.notificationFails) {
          return Promise.reject(new Error('notification service is down'));
        }
        harness.notifications.push(data);
        return Promise.resolve({});
      },
    },
  };

  return Object.assign(harness, {
    service: new ReportsService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

const read = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;

describe('reports', () => {
  it('files a report attributed to the caller', async () => {
    const harness = createHarness();
    const result = await harness.service.create(member, {
      entityType: 'POST',
      entityId: 'post-1',
      reason: ' Spam ',
    });

    expect(result.success).toBe(true);
    expect(read(harness.createdReport, 'reporterId')).toBe('member');
    expect(read(harness.createdReport, 'reason')).toBe('Spam');
    // Internal relations never reach the response.
    expect(result.report).not.toHaveProperty('reporter');
  });

  it('rejects an unsupported entity type or a missing reason', async () => {
    const harness = createHarness();
    await expect(
      harness.service.create(member, {
        entityType: 'GALAXY',
        entityId: 'x',
        reason: 'y',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      harness.service.create(member, { entityType: 'POST', entityId: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lets only an administrator read the queue, and bounds it', async () => {
    const harness = createHarness();

    await expect(
      harness.service.listForReview(member, {
        page: 1,
        limit: 20,
        status: null,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });

    const result = await harness.service.listForReview(admin, {
      page: 1,
      limit: 20,
      status: 'pending',
    });
    expect(result.reports.map((entry) => entry.id)).toEqual(['report-1']);
    expect(result.pagination).toEqual({ current: 1, pages: 1, total: 1 });
    expect(read(harness.lastReportWhere, 'status')).toBe('pending');
    expect(read(harness.lastFindManyArgs, 'take')).toBe(20);
  });

  it('requires an administrator with two factor to warn', async () => {
    const harness = createHarness();

    await expect(
      harness.service.warn(member, 'target', { reason: 'Abuse' }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      harness.service.warn(adminWithoutTwoFactor, 'target', {
        reason: 'Abuse',
      }),
    ).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
  });

  it('requires an auditable reason for every moderation action', async () => {
    const harness = createHarness();

    await expect(
      harness.service.warn(admin, 'target', {}),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      harness.service.ban(admin, 'target', {}),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(harness.users.get('target')?.warningCount).toBe(1);
  });

  it('warns a user and reports the new total', async () => {
    const harness = createHarness();
    const result = await harness.service.warn(admin, 'target', {
      reason: 'Harassment',
    });

    expect(result).toEqual({
      success: true,
      message: 'User warned',
      warningCount: 2,
    });
    expect(read(harness.notifications[0], 'type')).toBe('SYSTEM');
    expect(read(harness.notifications[0], 'recipientId')).toBe('target');
  });

  it('bans a user and stays idempotent on repeat', async () => {
    const harness = createHarness();

    await expect(
      harness.service.ban(admin, 'target', { reason: 'Fraud' }),
    ).resolves.toEqual({ success: true, message: 'User banned' });
    expect(harness.users.get('target')?.banned).toBe(true);
    expect(harness.notifications).toHaveLength(1);

    // A retry succeeds without sending a second suspension notice.
    await expect(
      harness.service.ban(admin, 'already-banned', { reason: 'Fraud' }),
    ).resolves.toEqual({ success: true, message: 'User banned' });
    expect(harness.notifications).toHaveLength(1);
  });

  it('reports a missing target rather than moderating nothing', async () => {
    const harness = createHarness();
    await expect(
      harness.service.warn(admin, 'ghost', { reason: 'Abuse' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('completes moderation even when the notification fails', async () => {
    const harness = createHarness();
    harness.notificationFails = true;

    await expect(
      harness.service.ban(admin, 'target', { reason: 'Fraud' }),
    ).resolves.toEqual({ success: true, message: 'User banned' });
    // The ban stands: notification delivery must not undo it.
    expect(harness.users.get('target')?.banned).toBe(true);
  });
});

describe('report routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(ReportsController.prototype, method);
    if (typeof handler !== 'function') {
      throw new Error(`ReportsController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact four legacy routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, ReportsController)).toBe(
      'api/reports',
    );

    const routes = [
      ['create', '/', RequestMethod.POST],
      ['listForReview', '/', RequestMethod.GET],
      ['warn', ':userId/warn', RequestMethod.POST],
      ['ban', ':userId/ban', RequestMethod.POST],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('guards the queue by role and moderation by role and two factor', () => {
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        handlerOf('listForReview'),
      ),
    ).toEqual([SessionGuard, RoleGuard]);

    for (const name of ['warn', 'ban']) {
      expect(
        reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf(name)),
      ).toEqual([SessionGuard, RoleGuard, TwoFactorGuard]);
    }

    // Filing a report is open to any signed-in user.
    expect(
      reflector.get<readonly unknown[]>(GUARDS_METADATA, handlerOf('create')),
    ).toBeUndefined();
  });
});
