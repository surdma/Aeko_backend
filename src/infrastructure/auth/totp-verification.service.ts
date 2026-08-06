import { createDecipheriv, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import speakeasy from 'speakeasy';
import { z } from 'zod';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import { APP_CONFIGURATION, type AppConfiguration } from '../../config/configuration.js';
import { AUTH_REPOSITORY, type AuthRepository, type SecurityRequestContext } from '../../modules/auth/auth.repository.js';

const stateSchema = z
  .object({
    isEnabled: z.boolean().default(false),
    secret: z.string().optional(),
  })
  .passthrough();

export type TwoFactorDecision =
  | 'not-required'
  | 'missing-token'
  | 'invalid-token'
  | 'verified'
  | 'failed';

function encryptionKey(value: string): Buffer {
  if (/^[0-9a-f]{64}$/iu.test(value)) return Buffer.from(value, 'hex');
  const direct = Buffer.from(value, 'utf8');
  return direct.length === 32 ? direct : createHash('sha256').update(value).digest();
}

function decryptSecret(value: string, key: Buffer): string {
  const [ivHex, tagHex, encryptedHex] = value.split(':');
  if (ivHex === undefined || tagHex === undefined || encryptedHex === undefined) {
    throw new Error('Invalid encrypted 2FA secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}

@Injectable()
export class TotpVerificationService {
  private readonly key: Buffer;

  public constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(APP_CONFIGURATION) configuration: AppConfiguration,
    private readonly logger: SanitizedLogger,
  ) {
    this.key = encryptionKey(configuration.auth.twoFactorSecretKey);
  }

  public async verifyForOperation(
    userId: string,
    token: string | undefined,
    requestContext: SecurityRequestContext,
  ): Promise<TwoFactorDecision> {
    try {
      const rawState = await this.repository.findTwoFactorState(userId);
      const parsed = stateSchema.safeParse(rawState);
      if (!parsed.success || !parsed.data.isEnabled) return 'not-required';
      if (token === undefined || token.length === 0) return 'missing-token';
      if (parsed.data.secret === undefined) return 'failed';

      const valid = speakeasy.totp.verify({
        secret: decryptSecret(parsed.data.secret, this.key),
        encoding: 'base32',
        token,
        window: 1,
      });
      if (!valid) {
        await this.audit(userId, false, 'Invalid TOTP token', requestContext);
        return 'invalid-token';
      }

      await this.repository.updateTwoFactorState(userId, {
        ...parsed.data,
        lastUsed: new Date().toISOString(),
      });
      await this.audit(userId, true, undefined, requestContext);
      return 'verified';
    } catch (error: unknown) {
      this.logger.error('2FA verification failed', { userId, error });
      await this.audit(userId, false, '2FA verification failed', requestContext);
      return 'failed';
    }
  }

  private async audit(
    userId: string,
    success: boolean,
    errorMessage: string | undefined,
    requestContext: SecurityRequestContext,
  ): Promise<void> {
    try {
      await this.repository.recordTwoFactorUse({
        userId,
        success,
        ...(errorMessage === undefined ? {} : { errorMessage }),
        ...requestContext,
      });
    } catch (error: unknown) {
      this.logger.warn('2FA audit write failed', { userId, error });
    }
  }
}
