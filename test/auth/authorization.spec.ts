import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  authorize,
  createAuthenticatedPrincipal,
} from '../../src/auth/auth.policy';
import type {
  AuthenticatedPrincipal,
  PrincipalCandidate,
} from '../../src/auth/auth.types';
import {
  getAuthenticatedPrincipal,
  type AuthenticatedRequest,
} from '../../src/auth/auth.request';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';

function candidate(
  overrides: Partial<PrincipalCandidate> = {},
): PrincipalCandidate {
  return {
    userId: 'user-1',
    email: 'user@example.com',
    username: 'aeko-user',
    isAdmin: false,
    banned: false,
    twoFactorEnabled: false,
    twoFactorSatisfied: true,
    sessionId: 'session-1',
    ...overrides,
  };
}

function principal(
  overrides: Partial<PrincipalCandidate> = {},
): AuthenticatedPrincipal {
  const value = createAuthenticatedPrincipal(candidate(overrides));
  if (!value) {
    throw new Error('Expected a full authenticated principal.');
  }
  return value;
}

describe('typed Aeko authorization boundaries', () => {
  it('permits anonymous access but requires a principal for protected access', () => {
    expect(authorize(undefined, { kind: 'anonymous' })).toBe('allow');
    expect(authorize(undefined, { kind: 'authenticated' })).toBe(
      'unauthenticated',
    );
    expect(authorize(principal(), { kind: 'authenticated' })).toBe('allow');
  });

  it('denies a banned principal at every protected boundary', () => {
    const banned = principal({ banned: true });

    expect(authorize(banned, { kind: 'authenticated' })).toBe('forbidden');
    expect(authorize(banned, { kind: 'role', role: 'admin' })).toBe(
      'forbidden',
    );
    expect(
      authorize(banned, { kind: 'ownership', ownerId: banned.userId }),
    ).toBe('forbidden');
  });

  it('enforces admin role and resource ownership independently', () => {
    const regular = principal();
    const admin = principal({ isAdmin: true });

    expect(authorize(regular, { kind: 'role', role: 'admin' })).toBe(
      'forbidden',
    );
    expect(authorize(admin, { kind: 'role', role: 'admin' })).toBe('allow');
    expect(
      authorize(regular, { kind: 'ownership', ownerId: regular.userId }),
    ).toBe('allow');
    expect(
      authorize(regular, { kind: 'ownership', ownerId: 'another-user' }),
    ).toBe('forbidden');
  });

  it('never creates a full principal for a partial two-factor sign-in', () => {
    const partial = createAuthenticatedPrincipal(
      candidate({ twoFactorEnabled: true, twoFactorSatisfied: false }),
    );

    expect(partial).toBeUndefined();
  });

  it('permits a completed two-factor principal and freezes its identity', () => {
    const complete = principal({
      twoFactorEnabled: true,
      twoFactorSatisfied: true,
    });

    expect(authorize(complete, { kind: 'two-factor' })).toBe('allow');
    expect(Object.isFrozen(complete)).toBe(true);
    expect(Object.keys(complete).sort()).toEqual(
      [
        'banned',
        'email',
        'isAdmin',
        'sessionId',
        'twoFactorEnabled',
        'twoFactorSatisfied',
        'userId',
        'username',
      ].sort(),
    );
  });

  it('attaches only the immutable principal for the current-user decorator path', async () => {
    const expected = principal();
    const request = { headers: {}, params: {} };
    const context = new ExecutionContextHost([request]);
    context.setType('http');
    const guard = new SessionGuard({
      resolvePrincipal: () => Promise.resolve(expected),
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    const authenticatedRequest = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    expect(getAuthenticatedPrincipal(authenticatedRequest)).toBe(expected);
    expect(Object.keys(request)).toEqual(['headers', 'params']);
  });
});
