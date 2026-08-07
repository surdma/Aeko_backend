import { Module } from '@nestjs/common';
import { ApiRateLimitModule } from '../../common/api-rate-limit.module.js';
import { LoggingModule } from '../../common/logging.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { PrismaSupportRepository } from '../../infrastructure/prisma/repositories/prisma-support.repository.js';
import { SupportAdminAccessGuard } from './support-admin-access.guard.js';
import { SupportController } from './support.controller.js';
import { SUPPORT_REPOSITORY } from './support.repository.js';
import { SupportService } from './support.service.js';

@Module({
  imports: [ApiRateLimitModule, LoggingModule, PrismaModule],
  controllers: [SupportController],
  providers: [
    SupportService,
    SupportAdminAccessGuard,
    { provide: SUPPORT_REPOSITORY, useClass: PrismaSupportRepository },
  ],
})
export class SupportModule {}
