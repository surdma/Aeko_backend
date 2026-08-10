import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import {
  parseNotificationListQuery,
  type NotificationPage,
  type NotificationSettings,
  type NotificationView,
} from './notification.contract';
import {
  NotificationRelayService,
  type RelayHealth,
} from './notification-relay.service';
import { NotificationsService } from './notifications.service';

/** Keeps proxies from idling out an otherwise silent connection. */
const HEARTBEAT_MILLISECONDS = 25_000;

interface StreamMessage {
  readonly type: 'notification' | 'heartbeat';
  readonly data: NotificationView | Record<string, never>;
}

@Controller('api/notifications')
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly relay: NotificationRelayService,
  ) {}

  /**
   * Realtime delivery health. Reports which transport is in force so an
   * operator is never left assuming cross-instance fan-out when only
   * in-process delivery is configured, and surfaces undelivered counts rather
   * than letting a broker outage stay silent.
   */
  @Get('realtime-health')
  realtimeHealth(): RelayHealth {
    return this.relay.health();
  }

  // Literal paths are declared before `:id`.
  @Get('settings')
  settings(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<NotificationSettings> {
    return this.notifications.settings(principal);
  }

  @Put('settings')
  updateSettings(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<NotificationSettings> {
    return this.notifications.updateSettings(principal, body);
  }

  @Put('push-token')
  registerPushToken(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<{ readonly message: string }> {
    return this.notifications.registerPushToken(principal, body);
  }

  @Get('unread-count')
  unreadCount(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<{ readonly count: number }> {
    return this.notifications.unreadCount(principal);
  }

  @Put('read-all')
  markAllRead(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<{ readonly message: string }> {
    return this.notifications.markAllRead(principal);
  }

  /**
   * Additive realtime delivery. Not a migrated capability: the REST inbox below
   * is unchanged, and a client that never opens this stream behaves exactly as
   * it does today.
   *
   * `EventSource` cannot set an `Authorization` header, so bearer-token clients
   * cannot use this route; cookie-session clients can.
   */
  @Sse('stream')
  stream(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Observable<StreamMessage> {
    return new Observable<StreamMessage>((subscriber) => {
      let closed = false;
      let close: (() => Promise<void>) | null = null;
      const heartbeat = setInterval(() => {
        subscriber.next({ type: 'heartbeat', data: {} });
      }, HEARTBEAT_MILLISECONDS);

      void (async () => {
        try {
          const subscription = await this.notifications.subscribe(principal);
          close = subscription.close.bind(subscription);
          if (closed) {
            await subscription.close();
            return;
          }
          for await (const notification of subscription.notifications) {
            if (closed) break;
            subscriber.next({ type: 'notification', data: notification });
          }
        } catch (error: unknown) {
          subscriber.error(error);
        }
      })();

      return () => {
        closed = true;
        clearInterval(heartbeat);
        // Without this the Redis subscriber connection would leak per client.
        void close?.();
      };
    });
  }

  @Get()
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<NotificationPage> {
    return this.notifications.list(
      principal,
      parseNotificationListQuery(query),
    );
  }

  @Put(':id/read')
  markRead(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<NotificationView> {
    return this.notifications.markRead(principal, id);
  }

  @Delete(':id')
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly message: string }> {
    return this.notifications.remove(principal, id);
  }
}
