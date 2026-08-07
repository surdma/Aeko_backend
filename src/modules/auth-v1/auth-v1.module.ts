import { Module } from '@nestjs/common';
import { LoggingModule } from '../../common/logging.module.js';
import { AppConfigurationModule } from '../../config/configuration.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AUTH_V1_EMAIL_SENDER } from './auth-v1-email-sender.port.js';
import { AuthV1Guard } from './auth-v1.guard.js';
import { BetterAuthV1Service } from './better-auth-v1.service.js';
import { ResendAuthV1EmailSender } from './resend-auth-v1-email-sender.js';

@Module({
  imports: [AppConfigurationModule, LoggingModule, PrismaModule],
  providers: [
    ResendAuthV1EmailSender,
    {
      provide: AUTH_V1_EMAIL_SENDER,
      useExisting: ResendAuthV1EmailSender,
    },
    BetterAuthV1Service,
    AuthV1Guard,
  ],
  exports: [BetterAuthV1Service, AuthV1Guard],
})
export class AuthV1Module {}
