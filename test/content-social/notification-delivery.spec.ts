import { ConfigurationService } from '../../src/configuration/configuration/configuration.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { InMemoryNotificationBusAdapter } from '../../src/notifications/in-memory-notification-bus.adapter';
import {
  NotificationBusPort,
  type NotificationSubscription,
  type PublishOutcome,
} from '../../src/notifications/notification-bus.port';
import { NotificationRelayService } from '../../src/notifications/notification-relay.service';
import type { NotificationEvent } from '../../src/notifications/notification.contract';

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
  sender: null;
}

const makeRow = (id: string, seconds: number, recipientId = 'viewer'): Row => ({
  id,
  recipientId,
  type: 'LIKE',
  title: null,
  message: null,
  entityId: null,
  entityType: null,
  read: false,
  metadata: {},
  createdAt: new Date(
    `2026-08-10T00:00:${String(seconds).padStart(2, '0')}.000Z`,
  ),
  sender: null,
});

/** A bus whose delivery outcome the test controls. */
class FlakyBus extends NotificationBusPort {
  readonly transport = 'redis' as const;
  published: string[] = [];
  failFrom: string | null = null;

  publish(notification: NotificationEvent): Promise<PublishOutcome> {
    if (this.failFrom !== null && notification.id >= this.failFrom) {
      return Promise.resolve('undelivered');
    }
    this.published.push(notification.id);
    return Promise.resolve('delivered');
  }

  subscribe(): Promise<NotificationSubscription> {
    throw new Error('unused');
  }
}

const createRelay = (
  rows: readonly Row[],
  bus: NotificationBusPort,
  redisUrl: string | null,
): NotificationRelayService => {
  const db = {
    notification: {
      findMany: ({
        where,
        take,
      }: {
        where: { createdAt: { gt: Date } };
        take: number;
      }): Promise<readonly unknown[]> =>
        Promise.resolve(
          [...rows]
            .filter((row) => row.createdAt > where.createdAt.gt)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, take),
        ),
    },
  };
  const configuration = {
    redisUrl,
  } as unknown as ConfigurationService;
  const relay = new NotificationRelayService(
    configuration,
    new PrismaService(
      db as unknown as ConstructorParameters<typeof PrismaService>[0],
    ),
    bus,
  );
  // Fixed replay floor so the fixtures are deterministic.
  relay.watermarkFrom(new Date('2026-08-10T00:00:00.000Z'));
  return relay;
};

describe('notification relay failure handling', () => {
  it('publishes rows written by any producer', async () => {
    const bus = new FlakyBus();
    const relay = createRelay(
      [makeRow('n1', 1), makeRow('n2', 2)],
      bus,
      'redis://x',
    );

    await expect(relay.scan()).resolves.toBe(2);
    expect(bus.published).toEqual(['n1', 'n2']);
  });

  it('does not republish a row it already delivered', async () => {
    const bus = new FlakyBus();
    const relay = createRelay([makeRow('n1', 1)], bus, 'redis://x');

    await relay.scan();
    await expect(relay.scan()).resolves.toBe(0);
    expect(bus.published).toEqual(['n1']);
  });

  it('holds the watermark at the first failure so nothing is lost', async () => {
    const bus = new FlakyBus();
    const rows = [makeRow('n1', 1), makeRow('n2', 2), makeRow('n3', 3)];
    const relay = createRelay(rows, bus, 'redis://x');

    // The broker fails from n2 onward.
    bus.failFrom = 'n2';
    await expect(relay.scan()).resolves.toBe(1);
    expect(bus.published).toEqual(['n1']);
    expect(relay.health().undeliveredSinceLastScan).toBe(2);

    // Once the broker recovers, the held rows are delivered — not skipped.
    bus.failFrom = null;
    await expect(relay.scan()).resolves.toBe(2);
    expect(bus.published).toEqual(['n1', 'n2', 'n3']);
  });

  it('retries indefinitely while the broker stays down', async () => {
    const bus = new FlakyBus();
    bus.failFrom = 'n1';
    const relay = createRelay([makeRow('n1', 1)], bus, 'redis://x');

    await expect(relay.scan()).resolves.toBe(0);
    await expect(relay.scan()).resolves.toBe(0);
    expect(bus.published).toEqual([]);

    bus.failFrom = null;
    await expect(relay.scan()).resolves.toBe(1);
    expect(bus.published).toEqual(['n1']);
  });

  it('survives a scan that throws and reports it', async () => {
    const bus = new FlakyBus();
    const relay = createRelay([], bus, null);
    const broken = new PrismaService({
      notification: {
        findMany: (): Promise<never> =>
          Promise.reject(new Error('database is down')),
      },
    } as unknown as ConstructorParameters<typeof PrismaService>[0]);
    Reflect.set(relay, 'prisma', broken);

    await expect(relay.scan()).rejects.toThrow('database is down');
    // The relay stays usable: a later scan succeeds.
    Reflect.set(
      relay,
      'prisma',
      new PrismaService({
        notification: {
          findMany: (): Promise<readonly unknown[]> => Promise.resolve([]),
        },
      } as unknown as ConstructorParameters<typeof PrismaService>[0]),
    );
    await expect(relay.scan()).resolves.toBe(0);
  });

  it('reports which transport is actually in force', () => {
    const withRedis = createRelay([], new FlakyBus(), 'redis://x');
    expect(withRedis.health().transport).toBe('redis');

    const withoutRedis = createRelay(
      [],
      new InMemoryNotificationBusAdapter(),
      null,
    );
    expect(withoutRedis.health().transport).toBe('in-process');
  });
});

describe('in-process notification bus', () => {
  const event = (recipientId: string, id = 'n1'): NotificationEvent =>
    Object.freeze({
      id,
      recipientId,
      type: 'LIKE',
      title: null,
      message: null,
      entityId: null,
      entityType: null,
      read: false,
      metadata: {},
      sender: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    });

  it('delivers realtime notifications without a broker', async () => {
    const bus = new InMemoryNotificationBusAdapter();
    const subscription = await bus.subscribe('viewer');
    const iterator = subscription.notifications[Symbol.asyncIterator]();

    await bus.publish(event('viewer'));
    const received = await iterator.next();

    expect(received.done).toBe(false);
    const delivered: unknown = received.value;
    expect(delivered).toMatchObject({ id: 'n1', recipientId: 'viewer' });
    await subscription.close();
  });

  it('never delivers another recipient notification', async () => {
    const bus = new InMemoryNotificationBusAdapter();
    const subscription = await bus.subscribe('viewer');
    const iterator = subscription.notifications[Symbol.asyncIterator]();

    await bus.publish(event('someone-else', 'foreign'));
    await subscription.close();

    // Closing ends the stream; the foreign event was never queued.
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('reports a publish with no local subscriber as delivered', async () => {
    const bus = new InMemoryNotificationBusAdapter();
    await expect(bus.publish(event('nobody'))).resolves.toBe('delivered');
  });

  it('stops delivering once the subscriber closes', async () => {
    const bus = new InMemoryNotificationBusAdapter();
    const subscription = await bus.subscribe('viewer');
    await subscription.close();

    await expect(bus.publish(event('viewer'))).resolves.toBe('delivered');
  });
});
