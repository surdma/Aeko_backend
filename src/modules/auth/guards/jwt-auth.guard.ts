import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request.js';
import { AuthService } from '../auth.service.js';
import type { AuthenticationResult } from '../auth.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  public constructor(private readonly authService: AuthService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawHeader = request.headers.authorization;
    const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const result = await this.authService.authenticate(header);
    return this.apply(result, request);
  }

  private apply(result: AuthenticationResult, request: AuthenticatedRequest): true {
    switch (result.kind) {
      case 'authenticated':
        request.user = result.user;
        request.userId = result.user.id;
        return true;
      case 'missing-token':
        throw new UnauthorizedException({ success: false, error: 'Unauthorized: No token provided' });
      case 'invalid-token-format':
        throw new ForbiddenException({ success: false, error: 'Forbidden: Invalid token format' });
      case 'invalid-token':
        throw new ForbiddenException({ success: false, error: 'Forbidden: Invalid token' });
      case 'expired-token':
        throw new UnauthorizedException({ success: false, error: 'Token expired' });
      case 'user-not-found':
        throw new NotFoundException({ success: false, error: 'User not found' });
      case 'account-suspended':
        throw new ForbiddenException({ success: false, error: 'Account suspended' });
      case 'unexpected':
        throw new InternalServerErrorException({ success: false, error: 'Internal Server Error' });
    }
  }
}
