import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { ConfigurationService } from '../configuration/configuration/configuration.service';
import { DomainError } from '../common/errors/domain.error';
import { parseNotificationEvent } from './notification.contract';
import type {
  NotificationEvent,
  NotificationView,
} from './notification.contract';
import {
  NotificationBusPort,
  type NotificationSubscription,
} from './notification-bus.port';

/** One channel per recipient: the channel is the authorization boundary. */
export const channelFor = (recipientId: string): string =>
  `aeko:notifications:${recipientId}`;

@Injectable()
export class RedisNotificationBusAdapter
  extends NotificationBusPort
  implements OnModuleDestroy
{
  private publisher: Redis | null = null;

  constructor(private readonly configuration: ConfigurationService) {
    super();
  }

  get enabled(): boolean {
    return this.configuration.redisUrl !== null;
  }

  async publish(notification: NotificationEvent): Promise<void> {
    const url = this.requireUrl();
    this.publisher ??= new Redis(url, { lazyConnect: false });
    try {
      await this.publisher.publish(
        channelFor(notification.recipientId),
        JSON.stringify(notification),
      );
    } catch {
      // Delivery is best effort: a broker outage must never fail the write
      // that produced the notification, and the relay republishes anything
      // that was missed.
    }
  }

  async subscribe(recipientId: string): Promise<NotificationSubscription> {
    const url = this.requireUrl();
    // A subscribing connection cannot issue other commands, so each
    // subscriber gets its own.
    const subscriber = new Redis(url, { lazyConnect: true });
    await subscriber.connect();
    await subscriber.subscribe(channelFor(recipientId));

    const queue: NotificationView[] = [];
    let resolveNext:
      ((value: IteratorResult<NotificationView>) => void) | null = null;
    let closed = false;

    subscriber.on('message', (_channel: string, payload: string) => {
      const event = parseNotificationEvent(payload);
      // A malformed payload is dropped rather than breaking the stream.
      if (event === null || event.recipientId !== recipientId) return;
      if (resolveNext !== null) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve({ value: event, done: false });
        return;
      }
      queue.push(event);
    });

    const notifications: AsyncIterable<NotificationView> = {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<NotificationView>> => {
          const queued = queue.shift();
          if (queued !== undefined) {
            return Promise.resolve({ value: queued, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },
      }),
    };

    return {
      notifications,
      close: async (): Promise<void> => {
        closed = true;
        if (resolveNext !== null) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({ value: undefined, done: true });
        }
        await subscriber.quit().catch(() => undefined);
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher?.quit().catch(() => undefined);
    this.publisher = null;
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
