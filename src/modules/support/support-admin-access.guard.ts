import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.js';

@Injectable()
export class SupportAdminAccessGuard implements CanActivate {
  public canActivate(context: ExecutionContext): true {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.isAdmin !== true) {
      throw new ForbiddenException({ error: 'Access denied. Admin only.' });
    }
    return true;
  }
}
