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
export class RoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!getAuthenticatedPrincipal(request)?.isAdmin) {
      throw new ForbiddenException('Access is denied.');
    }
    return true;
  }
}
