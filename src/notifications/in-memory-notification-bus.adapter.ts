import { Injectable } from '@nestjs/common';

import type { NotificationEvent } from './notification.contract';
import {
  createSubscriptionQueue,
  NotificationBusPort,
  type NotificationSubscription,
  type PublishOutcome,
} from './notification-bus.port';

/**
 * Realtime delivery without a broker.
 *
 * Installed when `REDIS_URL` is absent so a single-instance deployment still
 * gets working realtime notifications instead of a stream that reports the
 * capability as unavailable. It reaches only subscribers held by this process,
 * which is exactly the set that exists when there is one instance.
 *
 * It is not a substitute for Redis in a multi-instance deployment: a
 * subscriber connected to another replica will not see the event. That is why
 * `transport` is published — the health surface reports which guarantee is in
 * force rather than letting an operator assume the stronger one.
 */
@Injectable()
export class InMemoryNotificationBusAdapter extends NotificationBusPort {
  readonly transport = 'in-process' as const;

  private readonly listeners = new Map<
    string,
    Set<(event: NotificationEvent) => void>
  >();

  publish(notification: NotificationEvent): Promise<PublishOutcome> {
    const targets = this.listeners.get(notification.recipientId);
    // Delivery to zero local subscribers is still a successful publish: the
    // recipient simply has no stream open, exactly as with a broker.
    for (const listener of targets ?? []) listener(notification);
    return Promise.resolve('delivered');
  }

  subscribe(recipientId: string): Promise<NotificationSubscription> {
    const queue = createSubscriptionQueue();
    const listener = (event: NotificationEvent): void => {
      if (event.recipientId !== recipientId) return;
      queue.push(event);
    };
    const existing = this.listeners.get(recipientId) ?? new Set();
    existing.add(listener);
    this.listeners.set(recipientId, existing);

    queue.onClose(() => {
      const current = this.listeners.get(recipientId);
      current?.delete(listener);
      if (current !== undefined && current.size === 0) {
        this.listeners.delete(recipientId);
      }
      return Promise.resolve();
    });

    return Promise.resolve(queue.subscription);
  }
}
