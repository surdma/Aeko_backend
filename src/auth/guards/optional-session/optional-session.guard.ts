import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
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
export class OptionalSessionGuard implements CanActivate {
  constructor(
    @Inject(AuthRuntimeService) private readonly resolver: PrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.resolver.resolvePrincipal(request.headers);
    if (principal?.banned) {
      throw new ForbiddenException('Access is denied.');
    }
    if (principal) {
      attachAuthenticatedPrincipal(request, principal);
    }
    return true;
  }
}
