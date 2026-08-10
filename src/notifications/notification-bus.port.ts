import type {
  NotificationEvent,
  NotificationView,
} from './notification.contract';

/**
 * Fan-out for realtime notification delivery.
 *
 * Publishing is per-recipient so a subscriber never receives another user's
 * notification even before the service filters — the channel itself is the
 * authorization boundary.
 */
export abstract class NotificationBusPort {
  /** True when a broker is configured; false disables the SSE stream. */
  abstract readonly enabled: boolean;

  abstract publish(notification: NotificationEvent): Promise<void>;

  /**
   * Resolves an async iterable of that recipient's notifications. The returned
   * `close` must be called when the subscriber goes away; an SSE connection
   * that ends without it would leak a Redis subscriber.
   */
  abstract subscribe(recipientId: string): Promise<NotificationSubscription>;
}

export interface NotificationSubscription {
  readonly notifications: AsyncIterable<NotificationView>;
  close(): Promise<void>;
}
