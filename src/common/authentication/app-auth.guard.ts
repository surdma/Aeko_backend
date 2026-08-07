import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  APP_CONFIGURATION,
  type AppConfiguration,
} from '../../config/configuration.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { BetterAuthV1Service } from '../../modules/auth-v1/better-auth-v1.service.js';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard.js';
import { TwoFactorGuard } from '../../modules/auth/guards/two-factor.guard.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';
import {
  APP_ADMIN_REQUIRED_KEY,
  APP_TWO_FACTOR_REQUIRED_KEY,
} from './app-auth-policy.decorator.js';
import { PUBLIC_ROUTE_KEY } from './public-route.decorator.js';

function isAuthNamespace(path: string): boolean {
  return (
    path === '/api/auth' ||
    path.startsWith('/api/auth/') ||
    path === '/api/v0/auth' ||
    path.startsWith('/api/v0/auth/')
  );
}

@Injectable()
export class AppAuthGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIGURATION)
    private readonly configuration: AppConfiguration,
    private readonly betterAuth: BetterAuthV1Service,
    private readonly legacyGuard: JwtAuthGuard,
    private readonly legacyTwoFactorGuard: TwoFactorGuard,
    private readonly prisma: PrismaService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const publicRoute = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publicRoute === true || isAuthNamespace(request.path)) return true;

    if (this.configuration.authentication.mode === 'v0') {
      await this.legacyGuard.canActivate(context);
      await this.enforcePolicy(context, request);
      return true;
    }

    const session = await this.betterAuth.getSessionFromNodeHeaders(request.headers);
    if (session === null) {
      throw new UnauthorizedException({
        success: false,
        error: 'Authentication required',
      });
    }

    const [canonical, projection] = await Promise.all([
      this.prisma.authUser.findUnique({
        where: { id: session.user.id },
        select: { username: true, twoFactorEnabled: true },
      }),
      this.prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          username: true,
          isAdmin: true,
          banned: true,
        },
      }),
    ]);

    if (canonical === null || projection === null) {
      throw new NotFoundException({
        success: false,
        error: 'User not found',
      });
    }
    if (projection.banned) {
      throw new ForbiddenException({
        success: false,
        error: 'Account suspended',
      });
    }

    const twoFactorEnabled = canonical.twoFactorEnabled === true;
    request.user = {
      id: session.user.id,
      username: canonical.username ?? projection.username,
      email: session.user.email,
      name: session.user.name,
      isAdmin: projection.isAdmin,
      banned: false,
      twoFactorEnabled,
      twoFactorStatus: { isEnabled: twoFactorEnabled },
    };
    request.userId = session.user.id;
    await this.enforcePolicy(context, request);
    return true;
  }

  private async enforcePolicy(
    context: ExecutionContext,
    request: AuthenticatedRequest,
  ): Promise<void> {
    const adminRequired = this.reflector.getAllAndOverride<boolean>(
      APP_ADMIN_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (adminRequired === true && request.user?.isAdmin !== true) {
      throw new ForbiddenException({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }

    const twoFactorRequired = this.reflector.getAllAndOverride<boolean>(
      APP_TWO_FACTOR_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      twoFactorRequired === true &&
      this.configuration.authentication.mode === 'v0'
    ) {
      await this.legacyTwoFactorGuard.canActivate(context);
    }
  }
}
