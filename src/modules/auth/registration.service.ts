import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import { AUTH_EMAIL_DELIVERY, type AuthEmailDelivery } from './auth-email-delivery.port.js';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepository,
} from './authentication.repository.js';
import type { SignupInput, VerifyEmailInput } from './authentication.schemas.js';
import {
  accountUserView,
  createVerificationCode,
  dateFromUnknown,
  emailVerificationSchema,
  profileCompletionSchema,
} from './authentication-state.js';
import type {
  ResendVerificationResult,
  SignupResult,
  VerifyEmailResult,
} from './authentication.types.js';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.port.js';

@Injectable()
export class RegistrationService {
  public constructor(
    @Inject(AUTHENTICATION_REPOSITORY) private readonly accounts: AuthenticationRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(AUTH_EMAIL_DELIVERY) private readonly emailDelivery: AuthEmailDelivery,
    private readonly jwtService: JwtService,
    private readonly logger: SanitizedLogger,
  ) {}

  public async signup(input: SignupInput): Promise<SignupResult> {
    try {
      const existing = await this.accounts.findByEmailOrUsername(input.email, input.username);
      if (existing !== null) {
        return existing.email === input.email
          ? { kind: 'duplicate-email' }
          : { kind: 'duplicate-username' };
      }
      const code = createVerificationCode();
      const now = new Date();
      const result = await this.accounts.createCredentialAccount({
        name: input.name,
        username: input.username,
        email: input.email,
        passwordHash: await this.passwordHasher.hash(input.password, 10),
        verificationCode: code,
        verificationExpiresAt: new Date(now.getTime() + 600_000).toISOString(),
        now: now.toISOString(),
      });
      if (result.kind !== 'created') return result;
      const emailSent = await this.sendVerificationCode(
        input.email,
        code,
        input.name,
      );
      return {
        kind: 'created',
        userId: result.account.id,
        emailSent,
        verificationCode: code,
      };
    } catch (error: unknown) {
      this.logger.error('Registration failed', { error });
      return { kind: 'unexpected' };
    }
  }

  public async verifyEmail(input: VerifyEmailInput): Promise<VerifyEmailResult> {
    try {
      const account = await this.accounts.findById(input.userId);
      if (account === null) return { kind: 'user-not-found' };
      const parsed = emailVerificationSchema.safeParse(account.emailVerification);
      const state = parsed.success ? parsed.data : emailVerificationSchema.parse({});
      if (state.isVerified) return { kind: 'already-verified' };
      if (state.verificationCode == null) return { kind: 'missing-code' };
      const expiresAt = dateFromUnknown(state.codeExpiresAt);
      if (expiresAt !== null && expiresAt.getTime() < Date.now()) {
        return { kind: 'expired-code' };
      }
      if ((state.codeAttempts ?? 0) >= 3) return { kind: 'too-many-attempts' };
      if (state.verificationCode !== input.verificationCode) {
        await this.accounts.updateVerificationState(account.id, {
          ...state,
          codeAttempts: (state.codeAttempts ?? 0) + 1,
        });
        return { kind: 'invalid-code' };
      }
      const profile = profileCompletionSchema.safeParse(account.profileCompletion);
      const updated = await this.accounts.updateVerificationState(
        account.id,
        {
          ...state,
          isVerified: true,
          verificationCode: null,
          codeExpiresAt: null,
          codeAttempts: 0,
        },
        { ...(profile.success ? profile.data : {}), hasVerifiedEmail: true },
      );
      await this.deliver(() =>
        this.emailDelivery.sendWelcomeEmail(account.email, account.name),
      );
      const token = await this.jwtService.signAsync(
        { id: account.id },
        { expiresIn: 604_800 },
      );
      return { kind: 'verified', token, user: accountUserView(updated) };
    } catch (error: unknown) {
      this.logger.error('Email verification failed', { error });
      return { kind: 'unexpected' };
    }
  }

  public async resendVerification(userId: string): Promise<ResendVerificationResult> {
    try {
      const account = await this.accounts.findById(userId);
      if (account === null) return { kind: 'user-not-found' };
      const parsed = emailVerificationSchema.safeParse(account.emailVerification);
      const state = parsed.success ? parsed.data : emailVerificationSchema.parse({});
      if (state.isVerified) return { kind: 'already-verified' };
      const lastSent = dateFromUnknown(state.lastCodeSent);
      if (lastSent !== null && Date.now() - lastSent.getTime() < 60_000) {
        return { kind: 'rate-limited' };
      }
      const code = createVerificationCode();
      const now = new Date();
      await this.accounts.updateVerificationState(account.id, {
        ...state,
        verificationCode: code,
        codeExpiresAt: new Date(now.getTime() + 600_000).toISOString(),
        codeAttempts: 0,
        lastCodeSent: now.toISOString(),
      });
      const emailSent = await this.sendVerificationCode(
        account.email,
        code,
        account.name,
      );
      return { kind: 'sent', emailSent, verificationCode: code };
    } catch (error: unknown) {
      this.logger.error('Verification email resend failed', { error });
      return { kind: 'unexpected' };
    }
  }

  private async sendVerificationCode(
    email: string,
    code: string,
    name: string,
  ): Promise<boolean> {
    try {
      return await this.emailDelivery.sendVerificationCode(email, code, name);
    } catch (error: unknown) {
      this.logger.warn('Verification email delivery failed', { error });
      return false;
    }
  }

  private async deliver(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      this.logger.warn('Authentication email delivery failed', { error });
    }
  }
}
