import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import { AUTH_REPOSITORY, type AuthRepository } from './auth.repository.js';
import type { AuthenticationResult, AuthenticatedUser } from './auth.types.js';

const tokenClaimsSchema = z
  .object({
    id: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    partial: z.boolean().optional(),
  })
  .passthrough();

const twoFactorStateSchema = z.object({ isEnabled: z.boolean().default(false) }).passthrough();

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : undefined;
}

@Injectable()
export class AuthService {
  public constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly logger: SanitizedLogger,
  ) {}

  public async authenticate(authorizationHeader: string | undefined): Promise<AuthenticationResult> {
    const token = authorizationHeader?.split(' ')[1];
    if (!token) return { kind: 'missing-token' };

    try {
      const decoded = await this.jwtService.verifyAsync<unknown>(token);
      const parsed = tokenClaimsSchema.safeParse(decoded);
      if (!parsed.success) return { kind: 'invalid-token-format' };
      const userId = parsed.data.id ?? parsed.data.userId;
      if (userId === undefined) return { kind: 'invalid-token-format' };

      const identity = await this.repository.findIdentityById(userId);
      if (identity === null) return { kind: 'user-not-found' };
      if (identity.banned) return { kind: 'account-suspended' };

      const parsedTwoFactor = twoFactorStateSchema.safeParse(identity.twoFactorAuth);
      const twoFactorEnabled = parsedTwoFactor.success && parsedTwoFactor.data.isEnabled;
      const user: AuthenticatedUser = {
        id: identity.id,
        username: identity.username,
        email: identity.email,
        name: identity.name,
        isAdmin: identity.isAdmin,
        banned: false,
        twoFactorEnabled,
        twoFactorStatus: { isEnabled: twoFactorEnabled },
        ...(parsed.data.partial === true && twoFactorEnabled ? { partialLogin: true } : {}),
      };
      return { kind: 'authenticated', user };
    } catch (error: unknown) {
      const name = errorName(error);
      if (name === 'TokenExpiredError') return { kind: 'expired-token' };
      if (name === 'JsonWebTokenError' || name === 'NotBeforeError') return { kind: 'invalid-token' };
      this.logger.error('Authentication failed unexpectedly', { error });
      return { kind: 'unexpected' };
    }
  }
}
