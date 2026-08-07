import { Module } from '@nestjs/common';
import { ApiRateLimitModule } from '../../common/api-rate-limit.module.js';
import { LoggingModule } from '../../common/logging.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { PrismaNotificationsRepository } from '../../infrastructure/prisma/repositories/prisma-notifications.repository.js';
import { AuthV0Module } from '../auth/auth.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NOTIFICATIONS_REPOSITORY } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [ApiRateLimitModule, AuthV0Module, LoggingModule, PrismaModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATIONS_REPOSITORY,
      useClass: PrismaNotificationsRepository,
    },
  ],
})
export class NotificationsModule {}
