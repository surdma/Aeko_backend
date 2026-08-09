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
export class OwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = getAuthenticatedPrincipal(request);
    if (!principal || request.params.userId !== principal.userId) {
      throw new ForbiddenException('Access is denied.');
    }
    return true;
  }
}
