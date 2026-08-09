import type {
  AuthenticatedPrincipal,
  AuthorizationDecision,
  AuthorizationRequirement,
  PrincipalCandidate,
} from './auth.types';

export function createAuthenticatedPrincipal(
  candidate: PrincipalCandidate,
): AuthenticatedPrincipal | undefined {
  if (candidate.twoFactorEnabled && !candidate.twoFactorSatisfied) {
    return undefined;
  }
  return Object.freeze({
    userId: candidate.userId,
    email: candidate.email,
    username: candidate.username,
    isAdmin: candidate.isAdmin,
    banned: candidate.banned,
    twoFactorEnabled: candidate.twoFactorEnabled,
    twoFactorSatisfied: candidate.twoFactorSatisfied,
    sessionId: candidate.sessionId,
  });
}

export function authorize(
  principal: AuthenticatedPrincipal | undefined,
  requirement: AuthorizationRequirement,
): AuthorizationDecision {
  if (requirement.kind === 'anonymous') {
    return 'allow';
  }
  if (!principal) {
    return 'unauthenticated';
  }
  if (principal.banned) {
    return 'forbidden';
  }
  switch (requirement.kind) {
    case 'authenticated':
      return 'allow';
    case 'role':
      return requirement.role === 'user' || principal.isAdmin
        ? 'allow'
        : 'forbidden';
    case 'ownership':
      return principal.userId === requirement.ownerId ? 'allow' : 'forbidden';
    case 'two-factor':
      return !principal.twoFactorEnabled || principal.twoFactorSatisfied
        ? 'allow'
        : 'forbidden';
  }
}
