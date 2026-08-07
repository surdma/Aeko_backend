import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthV1Request } from './auth-v1-request.js';
import type { AuthV1SessionUser } from './better-auth-v1.service.js';

export const CurrentAuthV1User = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthV1SessionUser => {
    const request = context.switchToHttp().getRequest<AuthV1Request>();
    if (request.authV1 === undefined) {
      throw new UnauthorizedException({
        success: false,
        error: 'Authentication required',
      });
    }
    return request.authV1.user;
  },
);
