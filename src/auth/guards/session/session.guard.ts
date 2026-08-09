import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthRuntimeService,
  type PrincipalResolver,
} from '../../auth-runtime.service';
import {
  attachAuthenticatedPrincipal,
  type AuthenticatedRequest,
} from '../../auth.request';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AuthRuntimeService) private readonly resolver: PrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.resolver.resolvePrincipal(request.headers);
    if (!principal) {
      throw new UnauthorizedException('Authentication is required.');
    }
    if (principal.banned) {
      throw new ForbiddenException('Access is denied.');
    }
    attachAuthenticatedPrincipal(request, principal);
    return true;
  }
}
