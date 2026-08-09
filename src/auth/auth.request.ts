import type { Request } from 'express';
import type { AuthenticatedPrincipal } from './auth.types';

const AUTHENTICATED_PRINCIPAL = Symbol('AEKO_AUTHENTICATED_PRINCIPAL');

export type AuthenticatedRequest = Request & {
  [AUTHENTICATED_PRINCIPAL]?: AuthenticatedPrincipal;
};

export function attachAuthenticatedPrincipal(
  request: AuthenticatedRequest,
  principal: AuthenticatedPrincipal,
): void {
  Object.defineProperty(request, AUTHENTICATED_PRINCIPAL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: principal,
  });
}

export function getAuthenticatedPrincipal(
  request: AuthenticatedRequest,
): AuthenticatedPrincipal | undefined {
  return request[AUTHENTICATED_PRINCIPAL];
}
