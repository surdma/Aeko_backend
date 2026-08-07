import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthV1Request } from './auth-v1-request.js';
import { BetterAuthV1Service } from './better-auth-v1.service.js';

@Injectable()
export class AuthV1Guard implements CanActivate {
  public constructor(private readonly auth: BetterAuthV1Service) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthV1Request>();
    const session = await this.auth.getSessionFromNodeHeaders(request.headers);
    if (session === null) {
      throw new UnauthorizedException({
        success: false,
        error: 'Authentication required',
      });
    }
    request.authV1 = session;
    return true;
  }
}
