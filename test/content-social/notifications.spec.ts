import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  SSE_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { parseNotificationEvent } from '../../src/notifications/notification.contract';
import type {
  NotificationEvent,
  NotificationView,
} from '../../src/notifications/notification.contract';
import {
  NotificationBusPort,
  type NotificationSubscription,
} from '../../src/notifications/notification-bus.port';
import { NotificationsController } from '../../src/notifications/notifications.controller';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { channelFor } from '../../src/notifications/redis-notification-bus.adapter';

interface Row {
  id: string;
  recipientId: string;
  type: string;
  title: string | null;
  message: string | null;
  entityId: string | null;
  entityType: string | null;
  read: boolean;
  metadata: unknown;
  createdAt: Date;
}

const sender = {
  id: 'sender',
  name: 'Ada',
  username: 'ada',
  profilePicture: null,
  blueTick: false,
  goldenTick: false,
};

const makeRow = (overrides: Partial<Row>): Row => ({
  id: 'notification-1',
  recipientId: 'viewer',
  type: 'LIKE',
  title: 'New Like',
  message: 'Ada liked your post',
  entityId: 'post-1',
  entityType: 'POST',
  read: false,
  metadata: {},
  createdAt: new Date('2026-08-10T00:00:00.000Z'),
  ...overrides,
});

const viewer: AuthenticatedPrincipal = {
  userId: 'viewer',
  email: 'viewer@example.com',
  username: 'viewer',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 'session-viewer',
};

const intruder: AuthenticatedPrincipal = { ...viewer, userId: 'intruder' };

class StubBus extends NotificationBusPort {
  enabled = true;
  published: NotificationEvent[] = [];
  subscribedTo: string[] = [];
  closed = 0;

  publish(notification: NotificationEvent): Promise<void> {
    this.published.push(notification);
    return Promise.resolve();
  }

  subscribe(recipientId: string): Promise<NotificationSubscription> {
    this.subscribedTo.push(recipientId);
    return Promise.resolve({
      notifications: {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<NotificationView>>(() => undefined),
        }),
      },
      close: (): Promise<void> => {
        this.closed += 1;
        return Promise.resolve();
      },
    });
  }
}

interface Harness {
  readonly service: NotificationsService;
  readonly bus: StubBus;
  readonly rows: Map<string, Row>;
  settings: unknown;
  pushToken: string | null;
  lastWhere: unknown;
}

const createHarness = (rows: readonly Row[]): Harness => {
  const store = new Map(rows.map((row) => [row.id, row]));
  const bus = new StubBus();
  const harness: Harness = {
    service: undefined as unknown as NotificationsService,
    bus,
    rows: store,
    settings: null,
    pushToken: null,
    lastWhere: null,
  };

  const withSender = (row: Row): unknown => ({ ...row, sender });

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    if (
      where.recipientId !== undefined &&
      row.recipientId !== where.recipientId
    )
      return false;
    if (where.type !== undefined && row.type !== where.type) return false;
    if (where.read !== undefined && row.read !== where.read) return false;
    return true;
  };

  const db = {
    notification: {
      findMany: ({
        where,
      }: {
        where: Record<string, unknown>;
      }): Promise<readonly unknown[]> => {
        harness.lastWhere = where;
        return Promise.resolve(
          [...store.values()]
            .filter((row) => matches(row, where))
            .map(withSender),
        );
      },
      count: ({ where }: { where: Record<string, unknown> }): Promise<number> =>
        Promise.resolve(
          [...store.values()].filter((row) => matches(row, where)).length,
        ),
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> => {
        const row = store.get(where.id);
        return Promise.resolve(row === undefined ? null : withSender(row));
      },
      update: ({ where }: { where: { id: string } }): Promise<unknown> => {
        const row = store.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing'));
        const next = { ...row, read: true };
        store.set(next.id, next);
        return Promise.resolve(withSender(next));
      },
      updateMany: ({
        where,
      }: {
        where: Record<string, unknown>;
      }): Promise<unknown> => {
        for (const row of store.values()) {
          if (matches(row, where)) store.set(row.id, { ...row, read: true });
        }
        return Promise.resolve({ count: 0 });
      },
      delete: ({ where }: { where: { id: string } }): Promise<unknown> => {
        store.delete(where.id);
        return Promise.resolve({});
      },
    },
    user: {
      findUnique: (): Promise<unknown> =>
        Promise.resolve({ notificationSettings: harness.settings }),
      update: ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        if (typeof data.pushToken === 'string')
          harness.pushToken = data.pushToken;
        if (data.notificationSettings !== undefined) {
          harness.settings = data.notificationSettings;
        }
        return Promise.resolve({ notificationSettings: harness.settings });
      },
    },
  };

  return Object.assign(harness, {
    service: new NotificationsService(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
      bus,
    ),
  });
};

describe('notifications inbox', () => {
  it('lists only the caller notifications with the legacy envelope', async () => {
    const harness = createHarness([
      makeRow({}),
      makeRow({ id: 'other', recipientId: 'someone-else' }),
    ]);

    const page = await harness.service.list(viewer, {
      page: 1,
      limit: 20,
      unreadOnly: false,
      type: null,
    });

    expect(page.notifications.map((entry) => entry.id)).toEqual([
      'notification-1',
    ]);
    expect(page.pagination).toEqual({ current: 1, pages: 1, total: 1 });
    expect(page.notifications[0]).not.toHaveProperty('recipientId');
  });

  it('filters by type and unread', async () => {
    const harness = createHarness([
      makeRow({}),
      makeRow({ id: 'read-one', read: true, type: 'COMMENT' }),
    ]);

    await harness.service.list(viewer, {
      page: 1,
      limit: 20,
      unreadOnly: true,
      type: 'COMMENT',
    });

    expect(harness.lastWhere).toEqual({
      recipientId: 'viewer',
      type: 'COMMENT',
      read: false,
    });
  });

  it('counts only unread notifications', async () => {
    const harness = createHarness([
      makeRow({}),
      makeRow({ id: 'read-one', read: true }),
    ]);
    await expect(harness.service.unreadCount(viewer)).resolves.toEqual({
      count: 1,
    });
  });

  it('refuses to read or delete another recipient notification', async () => {
    const harness = createHarness([makeRow({})]);

    await expect(
      harness.service.markRead(intruder, 'notification-1'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      harness.service.remove(intruder, 'notification-1'),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      harness.service.markRead(viewer, 'missing'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(harness.rows.has('notification-1')).toBe(true);
  });

  it('marks one and all as read', async () => {
    const harness = createHarness([makeRow({}), makeRow({ id: 'second' })]);

    await expect(
      harness.service.markRead(viewer, 'notification-1'),
    ).resolves.toMatchObject({ read: true });
    await expect(harness.service.markAllRead(viewer)).resolves.toEqual({
      message: 'All notifications marked as read',
    });
    expect([...harness.rows.values()].every((row) => row.read)).toBe(true);
  });

  it('returns documented defaults when no settings are saved', async () => {
    const harness = createHarness([]);
    const settings = await harness.service.settings(viewer);

    expect(settings.interactions.likes).toBe(true);
    expect(settings.global.pauseAll).toBe(false);
  });

  it('validates settings instead of persisting the raw body', async () => {
    const harness = createHarness([]);
    await harness.service.updateSettings(viewer, {
      interactions: { likes: false },
    });

    expect(harness.settings).toMatchObject({
      interactions: { likes: false, comments: true },
    });
    await expect(
      harness.service.updateSettings(viewer, { recipientId: 'victim' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('stores a push token without echoing it', async () => {
    const harness = createHarness([]);
    const result = await harness.service.registerPushToken(viewer, {
      pushToken: ' device-abc ',
    });

    expect(harness.pushToken).toBe('device-abc');
    expect(JSON.stringify(result)).not.toContain('device-abc');
  });
});

describe('notification realtime delivery', () => {
  it('subscribes only to the caller channel', async () => {
    const harness = createHarness([]);
    const subscription = await harness.service.subscribe(viewer);

    expect(harness.bus.subscribedTo).toEqual(['viewer']);
    await subscription.close();
    expect(harness.bus.closed).toBe(1);
  });

  it('reports unavailable when no broker is configured', async () => {
    const harness = createHarness([]);
    harness.bus.enabled = false;

    await expect(harness.service.subscribe(viewer)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('scopes each recipient to a distinct channel', () => {
    expect(channelFor('viewer')).toBe('aeko:notifications:viewer');
    expect(channelFor('viewer')).not.toBe(channelFor('intruder'));
  });

  it('drops malformed or foreign broker payloads', () => {
    expect(parseNotificationEvent('not json')).toBeNull();
    expect(parseNotificationEvent('{"id":"x"}')).toBeNull();

    const valid = parseNotificationEvent(
      JSON.stringify({
        id: 'n1',
        recipientId: 'viewer',
        type: 'LIKE',
        title: null,
        message: null,
        entityId: null,
        entityType: null,
        read: false,
        metadata: {},
        sender: null,
        createdAt: '2026-08-10T00:00:00.000Z',
      }),
    );
    expect(valid?.recipientId).toBe('viewer');
  });
});

describe('notification routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(
      NotificationsController.prototype,
      method,
    );
    if (typeof handler !== 'function') {
      throw new Error(`NotificationsController.${method} is missing`);
    }
    return handler;
  };

  it('registers the exact eight legacy routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, NotificationsController)).toBe(
      'api/notifications',
    );
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        NotificationsController,
      ),
    ).toEqual([SessionGuard]);

    const routes = [
      ['settings', 'settings', RequestMethod.GET],
      ['updateSettings', 'settings', RequestMethod.PUT],
      ['registerPushToken', 'push-token', RequestMethod.PUT],
      ['list', '/', RequestMethod.GET],
      ['unreadCount', 'unread-count', RequestMethod.GET],
      ['markRead', ':id/read', RequestMethod.PUT],
      ['markAllRead', 'read-all', RequestMethod.PUT],
      ['remove', ':id', RequestMethod.DELETE],
    ] as const;

    for (const [name, path, method] of routes) {
      expect(reflector.get<unknown>(PATH_METADATA, handlerOf(name))).toBe(path);
      expect(reflector.get<unknown>(METHOD_METADATA, handlerOf(name))).toBe(
        method,
      );
    }
  });

  it('adds the stream as an SSE route without touching the eight', () => {
    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('stream'))).toBe(
      'stream',
    );
    expect(reflector.get<unknown>(SSE_METADATA, handlerOf('stream'))).toBe(
      true,
    );

    // The stream is additive: the legacy inbox count is unchanged.
    const legacy = Object.getOwnPropertyNames(
      NotificationsController.prototype,
    ).filter((name) => name !== 'constructor' && name !== 'stream');
    expect(legacy).toHaveLength(8);
  });

  it('declares every literal path before the parametric ones', () => {
    const order = Object.getOwnPropertyNames(NotificationsController.prototype)
      .filter((name) => name !== 'constructor')
      .flatMap((name) => {
        const handler: unknown = Reflect.get(
          NotificationsController.prototype,
          name,
        );
        if (typeof handler !== 'function') return [];
        const path = reflector.get<unknown>(PATH_METADATA, handler);
        return typeof path === 'string' ? [path] : [];
      });

    expect(order.indexOf('read-all')).toBeLessThan(order.indexOf(':id'));
    expect(order.indexOf('unread-count')).toBeLessThan(order.indexOf(':id'));
    expect(order.indexOf('settings')).toBeLessThan(order.indexOf(':id'));
  });
});
