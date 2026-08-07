import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import { APP_CONFIGURATION, type AppConfiguration } from '../../config/configuration.js';
import { AUTH_EMAIL_DELIVERY, type AuthEmailDelivery } from './auth-email-delivery.port.js';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepository,
} from './authentication.repository.js';
import type {
  ForgotPasswordInput,
  ResetPasswordInput,
} from './authentication.schemas.js';
import { resetTokenSchema } from './authentication-state.js';
import type {
  ForgotPasswordResult,
  ResetPasswordResult,
} from './authentication.types.js';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.port.js';

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timed-out'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

@Injectable()
export class PasswordRecoveryService {
  public constructor(
    @Inject(AUTHENTICATION_REPOSITORY) private readonly accounts: AuthenticationRepository,
    @Inject(AUTH_EMAIL_DELIVERY) private readonly emailDelivery: AuthEmailDelivery,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    private readonly jwtService: JwtService,
    @Inject(APP_CONFIGURATION) private readonly configuration: AppConfiguration,
    private readonly logger: SanitizedLogger,
  ) {}

  public async forgotPassword(input: ForgotPasswordInput): Promise<ForgotPasswordResult> {
    try {
      const result = await settleWithin(this.processForgotPassword(input), 10_000);
      return result === 'timed-out' ? { kind: 'timed-out' } : result;
    } catch (error: unknown) {
      this.logger.error('Forgot-password request failed', { error });
      return { kind: 'unexpected' };
    }
  }

  public async resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResult> {
    let userId: string;
    try {
      const parsed = resetTokenSchema.safeParse(
        await this.jwtService.verifyAsync<Readonly<Record<string, unknown>>>(input.token),
      );
      if (!parsed.success) return { kind: 'invalid-token' };
      userId = parsed.data.userId;
    } catch {
      return { kind: 'invalid-token' };
    }
    try {
      const account = await this.accounts.findById(userId);
      if (account === null) return { kind: 'user-not-found' };
      await this.accounts.updatePassword(
        account.id,
        await this.passwordHasher.hash(input.newPassword, 10),
      );
      return { kind: 'reset' };
    } catch (error: unknown) {
      this.logger.error('Password reset failed', { userId, error });
      return { kind: 'unexpected' };
    }
  }

  private async processForgotPassword(
    input: ForgotPasswordInput,
  ): Promise<ForgotPasswordResult> {
    const account = await this.accounts.findByEmail(input.email);
    if (account === null) return { kind: 'accepted' };
    const token = await this.jwtService.signAsync({ userId: account.id }, { expiresIn: 3600 });
    await this.emailDelivery.sendPasswordResetEmail(
      account.email,
      account.name,
      `${this.configuration.auth.frontendUrl}/reset-password?token=${token}`,
    );
    return { kind: 'accepted' };
  }
}
