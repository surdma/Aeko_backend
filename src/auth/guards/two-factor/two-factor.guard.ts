import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  getAuthenticatedPrincipal,
  type AuthenticatedRequest,
} from '../../auth.request';

@Injectable()
export class TwoFactorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = getAuthenticatedPrincipal(request);
    if (
      !principal ||
      (principal.twoFactorEnabled && !principal.twoFactorSatisfied)
    ) {
      throw new ForbiddenException('Two-factor authentication is required.');
    }
    return true;
  }
}
