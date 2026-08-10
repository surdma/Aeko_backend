import type {
  NotificationEvent,
  NotificationView,
} from './notification.contract';

/**
 * The outcome of one publish attempt.
 *
 * Publishing must never fail the database write that produced the
 * notification, but a failure must not vanish either: `undelivered` is
 * returned so the relay can hold its watermark and retry on the next scan.
 */
export type PublishOutcome = 'delivered' | 'undelivered';

/**
 * Fan-out for realtime notification delivery.
 *
 * Publishing is per-recipient so a subscriber never receives another user's
 * notification even before the service filters — the channel itself is the
 * authorization boundary.
 */
export abstract class NotificationBusPort {
  /**
   * How this bus reaches subscribers. `redis` fans out across every instance;
   * `in-process` only reaches subscribers on this one.
   */
  abstract readonly transport: 'redis' | 'in-process';

  abstract publish(notification: NotificationEvent): Promise<PublishOutcome>;

  /**
   * Resolves an async iterable of that recipient's notifications. The returned
   * `close` must be called when the subscriber goes away; an SSE connection
   * that ends without it would leak a subscriber.
   */
  abstract subscribe(recipientId: string): Promise<NotificationSubscription>;
}

export interface NotificationSubscription {
  readonly notifications: AsyncIterable<NotificationView>;
  close(): Promise<void>;
}

/**
 * Shared queue plumbing for a subscription: buffers events that arrive before
 * the consumer asks for them, and wakes a waiting consumer when one lands.
 */
export const createSubscriptionQueue = (): {
  readonly subscription: NotificationSubscription;
  push(event: NotificationView): void;
  finish(): void;
  onClose(handler: () => Promise<void>): void;
} => {
  const queued: NotificationView[] = [];
  let resolveNext: ((value: IteratorResult<NotificationView>) => void) | null =
    null;
  let closed = false;
  let onClose: (() => Promise<void>) | null = null;

  const finish = (): void => {
    closed = true;
    if (resolveNext !== null) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve({ value: undefined, done: true });
    }
  };

  return {
    subscription: {
      notifications: {
        [Symbol.asyncIterator]: () => ({
          next: (): Promise<IteratorResult<NotificationView>> => {
            const next = queued.shift();
            if (next !== undefined) {
              return Promise.resolve({ value: next, done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
        }),
      },
      close: async (): Promise<void> => {
        finish();
        await onClose?.();
      },
    },
    push: (event: NotificationView): void => {
      if (closed) return;
      if (resolveNext !== null) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve({ value: event, done: false });
        return;
      }
      queued.push(event);
    },
    finish,
    onClose: (handler: () => Promise<void>): void => {
      onClose = handler;
    },
  };
};
