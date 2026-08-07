import { Module } from '@nestjs/common';
import { LoggingModule } from '../../common/logging.module.js';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import {
  APP_CONFIGURATION,
  AppConfigurationModule,
  type AppConfiguration,
} from '../../config/configuration.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  AUTH_V1_EMAIL_SENDER,
  type AuthV1EmailSender,
} from './auth-v1-email-sender.port.js';
import {
  BETTER_AUTH_V1,
  createAekoBetterAuth,
} from './better-auth.factory.js';
import { ResendAuthV1EmailSender } from './resend-auth-v1-email-sender.js';

@Module({
  imports: [AppConfigurationModule, LoggingModule, PrismaModule],
  providers: [
    ResendAuthV1EmailSender,
    {
      provide: AUTH_V1_EMAIL_SENDER,
      useExisting: ResendAuthV1EmailSender,
    },
    {
      provide: BETTER_AUTH_V1,
      inject: [
        APP_CONFIGURATION,
        PrismaService,
        AUTH_V1_EMAIL_SENDER,
        SanitizedLogger,
      ],
      useFactory: (
        configuration: AppConfiguration,
        prisma: PrismaService,
        emailSender: AuthV1EmailSender,
        logger: SanitizedLogger,
      ) => createAekoBetterAuth(configuration, prisma, emailSender, logger),
    },
  ],
  exports: [BETTER_AUTH_V1],
})
export class AuthV1Module {}
