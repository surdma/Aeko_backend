import { Module } from '@nestjs/common';
import { CommunityProfilesController } from './community-profiles.controller';
import { CommunityProfilesService } from './community-profiles.service';

@Module({
  controllers: [CommunityProfilesController],
  providers: [CommunityProfilesService],
})
export class CommunityProfilesModule {}
