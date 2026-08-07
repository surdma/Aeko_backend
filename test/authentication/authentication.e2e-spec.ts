import 'reflect-metadata';
import {
  type CanActivate,
  type ExecutionContext,
  Module,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRateLimitModule } from '../../src/common/api-rate-limit.module.js';
import type { AuthenticatedRequest } from '../../src/common/types/authenticated-request.js';
import { APP_CONFIGURATION } from '../../src/config/configuration.js';
import { AuthenticatedAccountController } from '../../src/modules/auth/authenticated-account.controller.js';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard.js';
import { GoogleAuthenticationController } from '../../src/modules/auth/google-authentication.controller.js';
import { GoogleAuthenticationService } from '../../src/modules/auth/google-authentication.service.js';
import { PasswordRecoveryController } from '../../src/modules/auth/password-recovery.controller.js';
import { PasswordRecoveryService } from '../../src/modules/auth/password-recovery.service.js';
import { RegistrationController } from '../../src/modules/auth/registration.controller.js';
import { RegistrationService } from '../../src/modules/auth/registration.service.js';
import { SessionAuthenticationController } from '../../src/modules/auth/session-authentication.controller.js';
import { SessionAuthenticationService } from '../../src/modules/auth/session-authentication.service.js';

const userView = {
  id: 'user-1',
  name: 'Ada User',
  username: 'ada',
  email: 'ada@example.com',
  profilePicture: null,
  bio: null,
  blueTick: false,
  emailVerification: { isVerified: true },
  profileCompletion: {},
} as const;

const registration = {
  signup: vi.fn<RegistrationService['signup']>(),
  verifyEmail: vi.fn<RegistrationService['verifyEmail']>(),
  resendVerification: vi.fn<RegistrationService['resendVerification']>(),
};

const sessions = {
  login: vi.fn<SessionAuthenticationService['login']>(),
  profileCompletion: vi.fn<SessionAuthenticationService['profileCompletion']>(),
  currentUser: vi.fn<SessionAuthenticationService['currentUser']>(),
};

const googleAuthentication = {
  isConfigured: vi.fn(() => false),
  authorizationUrl: vi.fn<() => string | null>(() => null),
  callback: vi.fn<GoogleAuthenticationService['callback']>(),
  mobile: vi.fn<GoogleAuthenticationService['mobile']>(),
};

const recovery = {
  forgotPassword: vi.fn<PasswordRecoveryService['forgotPassword']>(),
  resetPassword: vi.fn<PasswordRecoveryService['resetPassword']>(),
};

const testConfiguration = {
  app: { environment: 'test' },
  auth: { google: { failureRedirect: 'aeko://auth/failed' } },
} as const;

class AllowJwtGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const incoming = context.switchToHttp().getRequest<AuthenticatedRequest>();
    incoming.userId = 'user-1';
    return true;
  }
}

@Module({
  imports: [ApiRateLimitModule],
  controllers: [
    GoogleAuthenticationController,
    RegistrationController,
    SessionAuthenticationController,
    AuthenticatedAccountController,
    PasswordRecoveryController,
  ],
  providers: [
    { provide: APP_CONFIGURATION, useValue: testConfiguration },
    { provide: RegistrationService, useValue: registration },
    { provide: SessionAuthenticationService, useValue: sessions },
    { provide: GoogleAuthenticationService, useValue: googleAuthentication },
    { provide: PasswordRecoveryService, useValue: recovery },
    { provide: JwtAuthGuard, useClass: AllowJwtGuard },
  ],
})
class TestAppModule {}

describe('authentication HTTP contract', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.resetAllMocks();
    googleAuthentication.isConfigured.mockReturnValue(false);
    googleAuthentication.authorizationUrl.mockReturnValue(null);

    const moduleReference = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = moduleReference.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('preserves signup validation and success responses', async () => {
    await request(app.getHttpServer()).post('/api/auth/signup').send({}).expect(400, {
      success: false,
      message: 'All fields are required',
    });

    registration.signup.mockResolvedValue({
      kind: 'created',
      userId: 'user-1',
      emailSent: true,
      verificationCode: '1234',
    });
    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        name: 'Ada User',
        username: 'ada',
        email: 'ada@example.com',
        password: 'password',
      })
      .expect(201, {
        success: true,
        message: 'Registration successful! Check your email for verification code',
        userId: 'user-1',
        emailSent: true,
      });
  });

  it('preserves the verification-code fallback when email delivery is unavailable', async () => {
    registration.signup.mockResolvedValue({
      kind: 'created',
      userId: 'user-1',
      emailSent: false,
      verificationCode: '4321',
    });

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        name: 'Ada User',
        username: 'ada',
        email: 'ada@example.com',
        password: 'password',
      })
      .expect(201, {
        success: true,
        message:
          'Registration successful! Email service unavailable. Your verification code is: 4321',
        userId: 'user-1',
        emailSent: false,
        verificationCode: '4321',
      });
  });

  it('returns HTTP 200 when valid credentials still require 2FA', async () => {
    sessions.login.mockResolvedValue({
      kind: 'two-factor-required',
      userId: 'user-1',
    });

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'password' })
      .expect(200, {
        success: false,
        message: '2FA verification required',
        requires2FA: true,
        userId: 'user-1',
      });
  });

  it('keeps password-recovery error keys and anti-enumeration response', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({})
      .expect(400, {
        success: false,
        error: 'Email is required',
      });

    recovery.forgotPassword.mockResolvedValue({ kind: 'accepted' });
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'unknown@example.com' })
      .expect(200, {
        success: true,
        message:
          'If an account with that email exists, a password reset link has been sent.',
      });
  });

  it('returns the legacy Google fallback before inspecting the request body', async () => {
    await request(app.getHttpServer()).get('/api/auth/google').expect(503, {
      success: false,
      message: 'Google OAuth is not configured on this server',
    });
    await request(app.getHttpServer())
      .post('/api/auth/google/mobile')
      .send({})
      .expect(503, {
        success: false,
        message: 'Google OAuth is not configured on this server',
      });
  });

  it('sets the OAuth cookie and deep-link redirect through the Nest controller', async () => {
    googleAuthentication.isConfigured.mockReturnValue(true);
    googleAuthentication.authorizationUrl.mockReturnValue(
      'https://accounts.google.com/auth',
    );
    googleAuthentication.callback.mockResolvedValue({
      kind: 'authenticated',
      token: 'jwt-token',
      user: userView,
    });

    const response = await request(app.getHttpServer())
      .get('/api/auth/google/callback?code=google-code')
      .expect(302);

    expect(response.headers.location).toBe('aeko://(home)?token=jwt-token');
    expect(response.headers['set-cookie']?.[0]).toContain('token=jwt-token');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('returns the authenticated account projection and clears the token cookie', async () => {
    sessions.currentUser.mockResolvedValue({ kind: 'found', user: userView });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer test-token')
      .expect(200, { success: true, user: userView });

    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .expect(200, { success: true, message: 'Logged out successfully' });
    expect(response.headers['set-cookie']?.[0]).toContain('token=;');
  });
});
