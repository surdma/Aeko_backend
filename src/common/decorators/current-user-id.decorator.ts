import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.userId === undefined) {
      throw new UnauthorizedException({
        success: false,
        error: 'Authentication required',
      });
    }
    return request.userId;
  },
);
