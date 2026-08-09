import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import {
  getAuthenticatedPrincipal,
  type AuthenticatedRequest,
} from '../../auth.request';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    getAuthenticatedPrincipal(
      context.switchToHttp().getRequest<AuthenticatedRequest>(),
    ),
);
