import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import { TotpVerificationService } from '../../infrastructure/auth/totp-verification.service.js';
import { AUTH_EMAIL_DELIVERY, type AuthEmailDelivery } from './auth-email-delivery.port.js';
import { AUTH_REPOSITORY, type AuthRepository, type SecurityRequestContext } from './auth.repository.js';
import { AUTHENTICATION_REPOSITORY, type AuthenticationRepository } from './authentication.repository.js';
import type { LoginInput } from './authentication.schemas.js';
import {
  accountUserView,
  emailVerificationSchema,
  profileCompletionSchema,
  twoFactorStateSchema,
} from './authentication-state.js';
import type {
  AuthenticationAccount,
  CurrentUserResult,
  LoginResult,
  ProfileCompletionResult,
} from './authentication.types.js';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.port.js';

@Injectable()
export class SessionAuthenticationService {
  public constructor(
    @Inject(AUTHENTICATION_REPOSITORY) private readonly accounts: AuthenticationRepository,
    @Inject(AUTH_REPOSITORY) private readonly accessRepository: AuthRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(AUTH_EMAIL_DELIVERY) private readonly emailDelivery: AuthEmailDelivery,
    private readonly jwtService: JwtService,
    private readonly totpVerification: TotpVerificationService,
    private readonly logger: SanitizedLogger,
  ) {}

  public async login(input: LoginInput, context: SecurityRequestContext): Promise<LoginResult> {
    try {
      const account = await this.accounts.findByEmail(input.email);
      if (
        account === null ||
        !(await this.passwordHasher.compare(input.password, account.password))
      ) {
        return { kind: 'invalid-credentials' };
      }
      const verification = emailVerificationSchema.safeParse(account.emailVerification);
      if (!verification.success || !verification.data.isVerified) {
        return { kind: 'email-not-verified', userId: account.id };
      }
      if (account.banned) return { kind: 'account-suspended' };
      const factor = await this.verifySecondFactor(account, input, context);
      if (factor === 'required') return { kind: 'two-factor-required', userId: account.id };
      if (factor === 'invalid') return { kind: 'invalid-second-factor' };
      if (factor === 'failed') return { kind: 'unexpected' };

      const token = await this.jwtService.signAsync({ id: account.id }, { expiresIn: 604_800 });
      void this.emailDelivery
        .sendLoginNotification(
          account.email,
          account.name,
          new Date().toLocaleString(),
          context.userAgent,
        )
        .catch((error: unknown) => {
          this.logger.warn('Login notification email failed', { accountId: account.id, error });
        });
      return {
        kind: 'authenticated',
        token,
        user: accountUserView(account, {
          goldenTick: true,
          admin: true,
          twoFactorEnabled: true,
        }),
      };
    } catch (error: unknown) {
      this.logger.error('Login failed', { error });
      return { kind: 'unexpected' };
    }
  }

  public async currentUser(userId: string): Promise<CurrentUserResult> {
    try {
      const account = await this.accounts.findById(userId);
      return account === null
        ? { kind: 'not-found' }
        : {
            kind: 'found',
            user: accountUserView(account, {
              avatar: true,
              goldenTick: true,
              admin: true,
              oauth: true,
              dates: true,
            }),
          };
    } catch (error: unknown) {
      this.logger.error('Current account lookup failed', { userId, error });
      return { kind: 'unexpected' };
    }
  }

  public async profileCompletion(userId: string): Promise<ProfileCompletionResult> {
    try {
      const account = await this.accounts.findById(userId);
      if (account === null) return { kind: 'not-found' };
      const parsed = profileCompletionSchema.safeParse(account.profileCompletion);
      const profile = parsed.success ? parsed.data : profileCompletionSchema.parse({});
      const nextSteps: string[] = [];
      if (profile.hasProfilePicture !== true) nextSteps.push('Add a profile picture');
      if (profile.hasBio !== true) nextSteps.push('Write a bio (minimum 10 characters)');
      if (profile.hasFollowers !== true) nextSteps.push('Get your first follower');
      if (profile.hasVerifiedEmail !== true) nextSteps.push('Verify your email address');
      return {
        kind: 'found',
        profileCompletion: {
          ...profile,
          blueTick: account.blueTick,
          nextSteps,
          requirements: {
            ...(profile.hasProfilePicture === undefined
              ? {}
              : { profilePicture: profile.hasProfilePicture }),
            ...(profile.hasBio === undefined ? {} : { bio: profile.hasBio }),
            ...(profile.hasFollowers === undefined
              ? {}
              : { followers: profile.hasFollowers }),
            ...(profile.hasVerifiedEmail === undefined
              ? {}
              : { email: profile.hasVerifiedEmail }),
          },
        },
      };
    } catch (error: unknown) {
      this.logger.error('Profile completion lookup failed', { userId, error });
      return { kind: 'unexpected' };
    }
  }

  private async verifySecondFactor(
    account: AuthenticationAccount,
    input: LoginInput,
    context: SecurityRequestContext,
  ): Promise<'not-required' | 'verified' | 'required' | 'invalid' | 'failed'> {
    const parsed = twoFactorStateSchema.safeParse(account.twoFactorAuth);
    if (!parsed.success || !parsed.data.isEnabled) return 'not-required';
    if (input.twoFactorToken === undefined && input.backupCode === undefined) return 'required';
    if (input.backupCode !== undefined) {
      const backupCodes = [...parsed.data.backupCodes];
      for (const [index, code] of backupCodes.entries()) {
        if (!code.used && (await this.passwordHasher.compare(input.backupCode, code.code))) {
          backupCodes[index] = { ...code, used: true, usedAt: new Date().toISOString() };
          await this.accessRepository.updateTwoFactorState(account.id, {
            ...parsed.data,
            backupCodes,
            lastUsed: new Date().toISOString(),
          });
          return 'verified';
        }
      }
      return 'invalid';
    }
    const decision = await this.totpVerification.verifyForOperation(
      account.id,
      input.twoFactorToken,
      context,
    );
    if (decision === 'verified') return 'verified';
    if (decision === 'invalid-token') return 'invalid';
    return decision === 'failed' ? 'failed' : 'invalid';
  }
}
