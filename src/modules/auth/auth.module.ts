import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LoggingModule } from '../../common/logging.module.js';
import { APP_CONFIGURATION, AppConfigurationModule, type AppConfiguration } from '../../config/configuration.js';
import { TotpVerificationService } from '../../infrastructure/auth/totp-verification.service.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { PrismaAuthRepository } from '../../infrastructure/prisma/repositories/prisma-auth.repository.js';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AdminGuard } from './guards/admin.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { TwoFactorGuard } from './guards/two-factor.guard.js';

@Module({
  imports: [
    AppConfigurationModule,
    LoggingModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [AppConfigurationModule],
      inject: [APP_CONFIGURATION],
      useFactory: (configuration: AppConfiguration) => ({
        secret: configuration.auth.jwtSecret,
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtAuthGuard,
    AdminGuard,
    TwoFactorGuard,
    TotpVerificationService,
    { provide: AUTH_REPOSITORY, useClass: PrismaAuthRepository },
  ],
  exports: [AuthService, JwtAuthGuard, AdminGuard, TwoFactorGuard],
})
export class AuthModule {}
