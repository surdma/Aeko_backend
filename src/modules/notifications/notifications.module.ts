import { Module } from '@nestjs/common';
import { ApiRateLimitModule } from '../../common/api-rate-limit.module.js';
import { LoggingModule } from '../../common/logging.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { PrismaNotificationsRepository } from '../../infrastructure/prisma/repositories/prisma-notifications.repository.js';
import { NotificationEventsService } from './notification-events.service.js';
import { NotificationStreamController } from './notification-stream.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { NOTIFICATIONS_REPOSITORY } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [ApiRateLimitModule, LoggingModule, PrismaModule],
  controllers: [NotificationsController, NotificationStreamController],
  providers: [
    NotificationsService,
    NotificationEventsService,
    {
      provide: NOTIFICATIONS_REPOSITORY,
      useClass: PrismaNotificationsRepository,
    },
  ],
  exports: [NotificationsService, NotificationEventsService],
})
export class NotificationsModule {}
