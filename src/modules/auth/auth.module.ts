import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiRateLimitModule } from '../../common/api-rate-limit.module.js';
import { LoggingModule } from '../../common/logging.module.js';
import {
  APP_CONFIGURATION,
  AppConfigurationModule,
  type AppConfiguration,
} from '../../config/configuration.js';
import { BcryptPasswordHasher } from '../../infrastructure/auth/bcrypt-password-hasher.js';
import { GoogleIdentityProviderService } from '../../infrastructure/auth/google-identity-provider.service.js';
import { TotpVerificationService } from '../../infrastructure/auth/totp-verification.service.js';
import { ZeptoMailAuthEmailService } from '../../infrastructure/email/zeptomail-auth-email.service.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { PrismaAuthRepository } from '../../infrastructure/prisma/repositories/prisma-auth.repository.js';
import { PrismaAuthenticationRepository } from '../../infrastructure/prisma/repositories/prisma-authentication.repository.js';
import { AuthenticatedAccountController } from './authenticated-account.controller.js';
import { AUTH_EMAIL_DELIVERY } from './auth-email-delivery.port.js';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AUTHENTICATION_REPOSITORY } from './authentication.repository.js';
import { GoogleAuthenticationService } from './google-authentication.service.js';
import { GOOGLE_IDENTITY_PROVIDER } from './google-identity-provider.port.js';
import { AdminGuard } from './guards/admin.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { TwoFactorGuard } from './guards/two-factor.guard.js';
import { GoogleAuthenticationController } from './google-authentication.controller.js';
import { PASSWORD_HASHER } from './password-hasher.port.js';
import { PasswordRecoveryController } from './password-recovery.controller.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';
import { SessionAuthenticationController } from './session-authentication.controller.js';
import { SessionAuthenticationService } from './session-authentication.service.js';

@Module({
  imports: [
    AppConfigurationModule,
    LoggingModule,
    PrismaModule,
    ApiRateLimitModule,
    JwtModule.registerAsync({
      imports: [AppConfigurationModule],
      inject: [APP_CONFIGURATION],
      useFactory: (configuration: AppConfiguration) => ({
        secret: configuration.auth.jwtSecret,
      }),
    }),
  ],
  controllers: [
    GoogleAuthenticationController,
    RegistrationController,
    SessionAuthenticationController,
    AuthenticatedAccountController,
    PasswordRecoveryController,
  ],
  providers: [
    AuthService,
    RegistrationService,
    SessionAuthenticationService,
    GoogleAuthenticationService,
    PasswordRecoveryService,
    JwtAuthGuard,
    AdminGuard,
    TwoFactorGuard,
    TotpVerificationService,
    { provide: AUTH_REPOSITORY, useClass: PrismaAuthRepository },
    {
      provide: AUTHENTICATION_REPOSITORY,
      useClass: PrismaAuthenticationRepository,
    },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    {
      provide: GOOGLE_IDENTITY_PROVIDER,
      useClass: GoogleIdentityProviderService,
    },
    { provide: AUTH_EMAIL_DELIVERY, useClass: ZeptoMailAuthEmailService },
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    AdminGuard,
    TwoFactorGuard,
    TotpVerificationService,
  ],
})
export class AuthModule {}
