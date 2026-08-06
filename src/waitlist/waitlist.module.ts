import { Module } from '@nestjs/common';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { LoggingModule } from '../common/logging.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { JoinWaitlistPipe } from './join-waitlist.pipe.js';
import { PrismaWaitlistRepository } from './prisma-waitlist.repository.js';
import { WaitlistController } from './waitlist.controller.js';
import { WAITLIST_REPOSITORY } from './waitlist.repository.js';
import { WaitlistService } from './waitlist.service.js';
import { WaitlistThrottlerExceptionFilter } from './waitlist-throttler-exception.filter.js';

@Module({
  imports: [
    LoggingModule,
    PrismaModule,
    ThrottlerModule.forRoot([
      {
        ttl: minutes(15),
        limit: 100,
      },
    ]),
  ],
  controllers: [WaitlistController],
  providers: [
    JoinWaitlistPipe,
    WaitlistService,
    WaitlistThrottlerExceptionFilter,
    {
      provide: WAITLIST_REPOSITORY,
      useClass: PrismaWaitlistRepository,
    },
  ],
})
export class WaitlistModule {}
