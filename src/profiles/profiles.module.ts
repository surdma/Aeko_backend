import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { AuthModule } from '../auth/auth.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [AuthModule, SecurityModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
