import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import type { SecurityRequestContext } from './auth.repository.js';
import type { AuthTokenCookieOptions } from './authentication.types.js';

export const GOOGLE_NOT_CONFIGURED = {
  success: false,
  message: 'Google OAuth is not configured on this server',
} as const;

export function legacyAuthFailure(
  status: number,
  body: Readonly<Record<string, unknown>>,
): never {
  throw new HttpException(body, status);
}

export function securityRequestContext(request: Request): SecurityRequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: request.ip || request.socket.remoteAddress || 'unknown',
    userAgent: typeof userAgent === 'string' ? userAgent : 'Unknown Device',
  };
}

export function googleFailureRedirect(base: string): string {
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}error=oauth_failed&message=${encodeURIComponent('Authentication failed')}`;
}

export function tokenCookieOptions(isProduction: boolean): AuthTokenCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 604_800_000,
  };
}

export function logoutCookieOptions(isProduction: boolean): AuthTokenCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
  };
}
