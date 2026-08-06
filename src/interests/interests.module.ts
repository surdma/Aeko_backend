import { Module } from '@nestjs/common';
import { ApiRateLimitModule } from '../common/api-rate-limit.module.js';
import { LoggingModule } from '../common/logging.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InterestsController } from './interests.controller.js';
import { INTERESTS_REPOSITORY } from './interests.repository.js';
import { InterestsService } from './interests.service.js';
import { PrismaInterestsRepository } from './prisma-interests.repository.js';

@Module({
  imports: [ApiRateLimitModule, LoggingModule, PrismaModule],
  controllers: [InterestsController],
  providers: [
    InterestsService,
    {
      provide: INTERESTS_REPOSITORY,
      useClass: PrismaInterestsRepository,
    },
  ],
})
export class InterestsModule {}
