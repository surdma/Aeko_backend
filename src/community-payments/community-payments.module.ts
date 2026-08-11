import { Module } from '@nestjs/common';
import { CommunityPaymentsController } from './community-payments.controller';
import { CommunityPaymentsService } from './community-payments.service';

@Module({
  controllers: [CommunityPaymentsController],
  providers: [CommunityPaymentsService],
})
export class CommunityPaymentsModule {}
