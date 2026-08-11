import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DebateScoringPort } from '../providers/debate-scoring/debate-scoring.port';
import { UnavailableDebateScoringAdapter } from '../providers/debate-scoring/unavailable-debate-scoring.adapter';
import { DebatesController } from './debates.controller';
import { DebatesService } from './debates.service';

@Module({
  imports: [AuthModule],
  controllers: [DebatesController],
  providers: [
    DebatesService,
    { provide: DebateScoringPort, useClass: UnavailableDebateScoringAdapter },
  ],
  exports: [DebatesService],
})
export class DebatesModule {}
