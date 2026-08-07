import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepository,
} from './authentication.repository.js';
import type { MobileGoogleInput } from './authentication.schemas.js';
import {
  accountUserView,
  emailVerificationSchema,
  normalizeUsernameBase,
} from './authentication-state.js';
import type {
  GoogleAuthenticationResult,
  GoogleIdentity,
} from './authentication.types.js';
import {
  GOOGLE_IDENTITY_PROVIDER,
  type GoogleIdentityProvider,
} from './google-identity-provider.port.js';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher.port.js';

@Injectable()
export class GoogleAuthenticationService {
  public constructor(
    @Inject(AUTHENTICATION_REPOSITORY) private readonly accounts: AuthenticationRepository,
    @Inject(GOOGLE_IDENTITY_PROVIDER) private readonly identityProvider: GoogleIdentityProvider,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    private readonly jwtService: JwtService,
    private readonly logger: SanitizedLogger,
  ) {}

  public isConfigured(): boolean {
    return this.identityProvider.isConfigured();
  }

  public authorizationUrl(): string | null {
    return this.isConfigured() ? this.identityProvider.createAuthorizationUrl() : null;
  }

  public async callback(code: string): Promise<GoogleAuthenticationResult> {
    if (!this.isConfigured()) return { kind: 'not-configured' };
    try {
      return await this.authenticate(
        await this.identityProvider.exchangeAuthorizationCode(code),
      );
    } catch (error: unknown) {
      this.logger.warn('Google OAuth callback verification failed', { error });
      return { kind: 'invalid-token' };
    }
  }

  public async mobile(input: MobileGoogleInput): Promise<GoogleAuthenticationResult> {
    if (!this.isConfigured()) return { kind: 'not-configured' };
    try {
      const verified = await this.identityProvider.verifyIdToken(input.idToken);
      return await this.authenticate({
        providerId: verified.providerId,
        email: verified.email,
        name: input.user?.name ?? verified.name,
        photo: input.user?.photo ?? verified.photo,
      });
    } catch (error: unknown) {
      this.logger.warn('Mobile Google token verification failed', { error });
      return { kind: 'invalid-token' };
    }
  }

  private async authenticate(identity: GoogleIdentity): Promise<GoogleAuthenticationResult> {
    try {
      let account = await this.accounts.findByGoogleIdentity(identity.providerId);
      if (account === null && identity.email !== null) {
        account = await this.accounts.findByEmail(identity.email);
      }
      if (account !== null && account.oauthId !== identity.providerId) {
        const verification = emailVerificationSchema.safeParse(account.emailVerification);
        account = await this.accounts.linkGoogleIdentity(
          account.id,
          identity.providerId,
          identity.photo ?? account.avatar ?? '',
          { ...(verification.success ? verification.data : {}), isVerified: true },
        );
      }
      if (account === null) {
        const email = identity.email ?? `${identity.providerId}@google-oauth.local`;
        const base = normalizeUsernameBase(
          identity.name ??
            identity.email?.split('@')[0] ??
            `user_${identity.providerId.slice(-6)}`,
        );
        let username = base;
        for (
          let counter = 1;
          (await this.accounts.findByUsername(username)) !== null;
          counter += 1
        ) {
          username = `${base}${counter}`;
        }
        const created = await this.accounts.createGoogleAccount({
          name: identity.name ?? username,
          username,
          email,
          passwordHash: await this.passwordHasher.hash(
            randomBytes(32).toString('hex'),
            10,
          ),
          oauthId: identity.providerId,
          avatar: identity.photo ?? '',
        });
        if (created.kind !== 'created') return { kind: 'unexpected' };
        account = created.account;
      }
      account = await this.accounts.updateGoogleLogin(
        account.id,
        new Date(),
        identity.photo ?? undefined,
      );
      const token = await this.jwtService.signAsync(
        { id: account.id, email: account.email },
        { expiresIn: 604_800 },
      );
      return {
        kind: 'authenticated',
        token,
        user: accountUserView(account, {
          avatar: true,
          goldenTick: true,
          admin: true,
          oauth: true,
        }),
      };
    } catch (error: unknown) {
      this.logger.error('Google account authentication failed', { error });
      return { kind: 'unexpected' };
    }
  }
}
