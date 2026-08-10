import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationBusPort } from './notification-bus.port';
import { NotificationRelayService } from './notification-relay.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RedisNotificationBusAdapter } from './redis-notification-bus.adapter';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRelayService,
    { provide: NotificationBusPort, useClass: RedisNotificationBusAdapter },
  ],
  exports: [NotificationsService, NotificationBusPort],
})
export class NotificationsModule {}
