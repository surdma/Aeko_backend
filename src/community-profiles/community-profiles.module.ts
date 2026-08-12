import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../providers/media/media.module';
import { CommunityProfilesController } from './community-profiles.controller';
import { CommunityProfilesService } from './community-profiles.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [CommunityProfilesController],
  providers: [CommunityProfilesService],
  exports: [CommunityProfilesService],
})
export class CommunityProfilesModule {}
