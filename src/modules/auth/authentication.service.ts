import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIGURATION, type AppConfiguration } from '../../config/configuration.js';
import type { SecurityRequestContext } from './auth.repository.js';
import type {
  ForgotPasswordInput,
  LoginInput,
  MobileGoogleInput,
  ResetPasswordInput,
  SignupInput,
  VerifyEmailInput,
} from './authentication.schemas.js';
import type {
  AuthTokenCookieOptions,
  CurrentUserResult,
  ForgotPasswordResult,
  GoogleAuthenticationResult,
  LoginResult,
  ProfileCompletionResult,
  ResendVerificationResult,
  ResetPasswordResult,
  SignupResult,
  VerifyEmailResult,
} from './authentication.types.js';
import { GoogleAuthenticationService } from './google-authentication.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { RegistrationService } from './registration.service.js';
import { SessionAuthenticationService } from './session-authentication.service.js';

function failureRedirect(base: string): string {
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}error=oauth_failed&message=${encodeURIComponent('Authentication failed')}`;
}

@Injectable()
export class AuthenticationService {
  public constructor(
    private readonly registration: RegistrationService,
    private readonly sessions: SessionAuthenticationService,
    private readonly google: GoogleAuthenticationService,
    private readonly recovery: PasswordRecoveryService,
    @Inject(APP_CONFIGURATION) private readonly configuration: AppConfiguration,
  ) {}

  public isGoogleConfigured(): boolean {
    return this.google.isConfigured();
  }

  public googleAuthorizationUrl(): string | null {
    return this.google.authorizationUrl();
  }

  public googleFailureUrl(): string {
    return this.configuration.auth.google.failureRedirect;
  }

  public googleFailureRedirect(): string {
    return failureRedirect(this.googleFailureUrl());
  }

  public tokenCookieOptions(): AuthTokenCookieOptions {
    return {
      httpOnly: true,
      secure: this.configuration.app.environment === 'production',
      sameSite: 'lax',
      maxAge: 604_800_000,
    };
  }

  public logoutCookieOptions(): AuthTokenCookieOptions {
    return {
      httpOnly: true,
      secure: this.configuration.app.environment === 'production',
      sameSite: 'lax',
    };
  }

  public authenticateGoogleCallback(code: string): Promise<GoogleAuthenticationResult> {
    return this.google.callback(code);
  }

  public authenticateGoogleMobile(input: MobileGoogleInput): Promise<GoogleAuthenticationResult> {
    return this.google.mobile(input);
  }

  public signup(input: SignupInput): Promise<SignupResult> {
    return this.registration.signup(input);
  }

  public verifyEmail(input: VerifyEmailInput): Promise<VerifyEmailResult> {
    return this.registration.verifyEmail(input);
  }

  public resendVerification(userId: string): Promise<ResendVerificationResult> {
    return this.registration.resendVerification(userId);
  }

  public login(input: LoginInput, context: SecurityRequestContext): Promise<LoginResult> {
    return this.sessions.login(input, context);
  }

  public currentUser(userId: string): Promise<CurrentUserResult> {
    return this.sessions.currentUser(userId);
  }

  public profileCompletion(userId: string): Promise<ProfileCompletionResult> {
    return this.sessions.profileCompletion(userId);
  }

  public forgotPassword(input: ForgotPasswordInput): Promise<ForgotPasswordResult> {
    return this.recovery.forgotPassword(input);
  }

  public resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResult> {
    return this.recovery.resetPassword(input);
  }
}
