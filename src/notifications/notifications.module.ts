import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ConfigurationService } from '../configuration/configuration/configuration.service';
import { InMemoryNotificationBusAdapter } from './in-memory-notification-bus.adapter';
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
    {
      provide: NotificationBusPort,
      // Redis fans out across instances; without it realtime still works on a
      // single instance rather than being switched off entirely.
      useFactory: (configuration: ConfigurationService): NotificationBusPort =>
        configuration.redisUrl === null
          ? new InMemoryNotificationBusAdapter()
          : new RedisNotificationBusAdapter(configuration),
      inject: [ConfigurationService],
    },
  ],
  exports: [NotificationsService, NotificationBusPort],
})
export class NotificationsModule {}
