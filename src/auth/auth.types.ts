export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly banned: boolean;
  readonly twoFactorEnabled: boolean;
  readonly twoFactorSatisfied: boolean;
  readonly sessionId: string;
}

export type PrincipalCandidate = AuthenticatedPrincipal;

export type AuthorizationRequirement =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'role'; readonly role: 'admin' | 'user' }
  | { readonly kind: 'ownership'; readonly ownerId: string }
  | { readonly kind: 'two-factor' };

export type AuthorizationDecision = 'allow' | 'unauthenticated' | 'forbidden';
