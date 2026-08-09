import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Module({
  imports: [AuthModule],
  controllers: [AdsController],
  providers: [AdsService],
})
export class AdsModule {}
