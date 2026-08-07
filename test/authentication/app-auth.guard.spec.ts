import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAuthGuard } from '../../src/common/authentication/app-auth.guard.js';
import type { AuthenticatedRequest } from '../../src/common/types/authenticated-request.js';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import type { BetterAuthV1Service } from '../../src/modules/auth-v1/better-auth-v1.service.js';
import type { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard.js';
import type { TwoFactorGuard } from '../../src/modules/auth/guards/two-factor.guard.js';

function configuration(mode: 'better-auth' | 'v0'): AppConfiguration {
  return { authentication: { mode } } as unknown as AppConfiguration;
}

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('AppAuthGuard', () => {
  const reflector = {
    getAllAndOverride: vi.fn(),
  } as unknown as Reflector;
  const betterAuth = {
    getSessionFromNodeHeaders: vi.fn(),
  } as unknown as BetterAuthV1Service;
  const legacyGuard = {
    canActivate: vi.fn(),
  } as unknown as JwtAuthGuard;
  const legacyTwoFactorGuard = {
    canActivate: vi.fn(),
  } as unknown as TwoFactorGuard;
  const prisma = {
    authUser: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  } as unknown as PrismaService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(false);
  });

  it('bypasses explicitly public routes without invoking either auth provider', async () => {
    vi.mocked(reflector.getAllAndOverride).mockReturnValue(true);
    const request = { path: '/health/live', headers: {} } as AuthenticatedRequest;
    const guard = new AppAuthGuard(
      reflector,
      configuration('better-auth'),
      betterAuth,
      legacyGuard,
      legacyTwoFactorGuard,
      prisma,
    );

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(betterAuth.getSessionFromNodeHeaders).not.toHaveBeenCalled();
    expect(legacyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('normalizes a Better Auth session into the app principal', async () => {
    vi.mocked(betterAuth.getSessionFromNodeHeaders).mockResolvedValue({
      user: {
        id: 'user-1',
        name: 'Canonical User',
        email: 'canonical@example.com',
        emailVerified: true,
        image: null,
      },
      session: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    vi.mocked(prisma.authUser.findUnique).mockResolvedValue({
      username: 'canonical',
      twoFactorEnabled: false,
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      username: 'canonical',
      isAdmin: true,
      banned: false,
    } as never);
    const request = {
      path: '/api/notifications/settings',
      headers: {},
    } as AuthenticatedRequest;
    const guard = new AppAuthGuard(
      reflector,
      configuration('better-auth'),
      betterAuth,
      legacyGuard,
      legacyTwoFactorGuard,
      prisma,
    );

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({
      id: 'user-1',
      username: 'canonical',
      email: 'canonical@example.com',
      isAdmin: true,
    });
    expect(request.userId).toBe('user-1');
    expect(legacyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates protected application routes to the v0 JWT guard when selected', async () => {
    vi.mocked(legacyGuard.canActivate).mockImplementation(async (context) => {
      const request = context
        .switchToHttp()
        .getRequest<AuthenticatedRequest>();
      request.user = {
        id: 'legacy-user',
        username: 'legacy',
        email: 'legacy@example.com',
        name: 'Legacy User',
        isAdmin: false,
        banned: false,
        twoFactorEnabled: false,
        twoFactorStatus: { isEnabled: false },
      };
      request.userId = 'legacy-user';
      return true;
    });
    const request = {
      path: '/api/notifications/settings',
      headers: {},
    } as AuthenticatedRequest;
    const context = contextFor(request);
    const guard = new AppAuthGuard(
      reflector,
      configuration('v0'),
      betterAuth,
      legacyGuard,
      legacyTwoFactorGuard,
      prisma,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(legacyGuard.canActivate).toHaveBeenCalledWith(context);
    expect(betterAuth.getSessionFromNodeHeaders).not.toHaveBeenCalled();
  });
});
