import { Module } from '@nestjs/common';
import { ApiRateLimitModule } from '../../common/api-rate-limit.module.js';
import { LoggingModule } from '../../common/logging.module.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { PrismaInterestsRepository } from '../../infrastructure/prisma/repositories/prisma-interests.repository.js';
import { AuthV0Module } from '../auth/auth.module.js';
import { InterestsController } from './interests.controller.js';
import { INTERESTS_REPOSITORY } from './interests.repository.js';
import { InterestsService } from './interests.service.js';
import { UserInterestsController } from './user-interests.controller.js';

@Module({
  imports: [ApiRateLimitModule, AuthV0Module, LoggingModule, PrismaModule],
  controllers: [InterestsController, UserInterestsController],
  providers: [
    InterestsService,
    { provide: INTERESTS_REPOSITORY, useClass: PrismaInterestsRepository },
  ],
})
export class InterestsModule {}
