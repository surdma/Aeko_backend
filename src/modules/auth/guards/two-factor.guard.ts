import { ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.js';
import { TotpVerificationService } from '../../../infrastructure/auth/totp-verification.service.js';

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class TwoFactorGuard implements CanActivate {
  public constructor(private readonly verifier: TotpVerificationService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user === undefined) {
      throw new UnauthorizedException({ success: false, message: 'Authentication required' });
    }

    const forwarded = firstHeader(request.headers['x-forwarded-for']);
    const decision = await this.verifier.verifyForOperation(
      request.user.id,
      firstHeader(request.headers['x-2fa-token']),
      {
        ipAddress: request.ip || forwarded?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown',
        userAgent: request.get('User-Agent') || 'unknown',
      },
    );

    switch (decision) {
      case 'not-required':
        return true;
      case 'verified':
        request.twoFactorVerified = true;
        return true;
      case 'missing-token':
        throw new ForbiddenException({
          success: false,
          message: '2FA verification required for this operation',
          requiresTwoFactor: true,
          code: '2FA_REQUIRED',
        });
      case 'invalid-token':
        throw new ForbiddenException({
          success: false,
          message: 'Invalid 2FA token',
          requiresTwoFactor: true,
          code: 'INVALID_2FA_TOKEN',
        });
      case 'failed':
        throw new InternalServerErrorException({
          success: false,
          message: 'Internal server error during 2FA verification',
        });
    }
  }
}
