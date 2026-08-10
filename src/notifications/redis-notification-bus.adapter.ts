import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { ConfigurationService } from '../configuration/configuration/configuration.service';
import { DomainError } from '../common/errors/domain.error';
import { parseNotificationEvent } from './notification.contract';
import type { NotificationEvent } from './notification.contract';
import {
  createSubscriptionQueue,
  NotificationBusPort,
  type NotificationSubscription,
  type PublishOutcome,
} from './notification-bus.port';

/** One channel per recipient: the channel is the authorization boundary. */
export const channelFor = (recipientId: string): string =>
  `aeko:notifications:${recipientId}`;

@Injectable()
export class RedisNotificationBusAdapter
  extends NotificationBusPort
  implements OnModuleDestroy
{
  readonly transport = 'redis' as const;

  private readonly logger = new Logger(RedisNotificationBusAdapter.name);
  private publisher: Redis | null = null;
  private degraded = false;

  constructor(private readonly configuration: ConfigurationService) {
    super();
  }

  /**
   * A broker failure must not fail the write that produced the notification,
   * so this never throws — but it reports `undelivered` so the relay holds its
   * watermark and retries rather than losing the event.
   */
  async publish(notification: NotificationEvent): Promise<PublishOutcome> {
    try {
      this.publisher ??= new Redis(this.requireUrl(), {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
      });
      await this.publisher.publish(
        channelFor(notification.recipientId),
        JSON.stringify(notification),
      );
      this.recover();
      return 'delivered';
    } catch (error: unknown) {
      this.reportDegraded(error);
      return 'undelivered';
    }
  }

  async subscribe(recipientId: string): Promise<NotificationSubscription> {
    // A subscribing connection cannot issue other commands, so each
    // subscriber gets its own.
    const subscriber = new Redis(this.requireUrl(), { lazyConnect: true });
    const queue = createSubscriptionQueue();

    queue.onClose(async () => {
      await subscriber.quit().catch(() => undefined);
    });

    subscriber.on('message', (_channel: string, payload: string) => {
      const event = parseNotificationEvent(payload);
      // Broker payloads are untrusted: malformed or foreign messages are
      // dropped rather than propagated to the subscriber.
      if (event === null || event.recipientId !== recipientId) return;
      queue.push(event);
    });

    // A dropped subscriber connection ends the stream cleanly; the client
    // reconnects and the relay replays anything published in the gap.
    subscriber.on('end', () => {
      queue.finish();
    });

    try {
      await subscriber.connect();
      await subscriber.subscribe(channelFor(recipientId));
    } catch {
      await subscriber.quit().catch(() => undefined);
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Realtime notifications are temporarily unavailable.',
      );
    }

    return queue.subscription;
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher?.quit().catch(() => undefined);
    this.publisher = null;
  }

  /** Logged once per outage rather than once per notification. */
  private reportDegraded(error: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    const reason = error instanceof Error ? error.message : 'unknown error';
    this.logger.warn(
      `Realtime notification publishing is degraded: ${reason}. ` +
        'Notifications are still persisted and will be replayed by the relay.',
    );
    this.publisher = null;
  }

  private recover(): void {
    if (!this.degraded) return;
    this.degraded = false;
    this.logger.log('Realtime notification publishing recovered.');
  }

  private requireUrl(): string {
    const url = this.configuration.redisUrl;
    if (url === null) {
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Realtime notifications are not configured.',
      );
    }
    return url;
  }
}
