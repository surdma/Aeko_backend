import { Module } from '@nestjs/common';
import { ApiRateLimitModule } from '../common/api-rate-limit.module.js';
import { LoggingModule } from '../common/logging.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { JoinWaitlistPipe } from './join-waitlist.pipe.js';
import { PrismaWaitlistRepository } from './prisma-waitlist.repository.js';
import { WaitlistController } from './waitlist.controller.js';
import { WAITLIST_REPOSITORY } from './waitlist.repository.js';
import { WaitlistService } from './waitlist.service.js';

@Module({
  imports: [ApiRateLimitModule, LoggingModule, PrismaModule],
  controllers: [WaitlistController],
  providers: [
    JoinWaitlistPipe,
    WaitlistService,
    {
      provide: WAITLIST_REPOSITORY,
      useClass: PrismaWaitlistRepository,
    },
  ],
})
export class WaitlistModule {}
