import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuthModule } from '../auth/auth.module';
import { SecurityEventService } from './security-event.service';

@Module({
  imports: [AuthModule],
  controllers: [SecurityController],
  providers: [SecurityService, SecurityEventService],
  exports: [SecurityService, SecurityEventService],
})
export class SecurityModule {}
