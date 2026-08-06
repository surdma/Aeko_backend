import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.js';

@Injectable()
export class AdminGuard implements CanActivate {
  public canActivate(context: ExecutionContext): true {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user === undefined) {
      throw new UnauthorizedException({ success: false, message: 'No token, authorization denied' });
    }
    if (!request.user.isAdmin) {
      throw new ForbiddenException({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }
    return true;
  }
}
