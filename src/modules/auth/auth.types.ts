export interface IdentityRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly name: string;
  readonly isAdmin: boolean;
  readonly banned: boolean;
  readonly twoFactorAuth: unknown;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly name: string;
  readonly isAdmin: boolean;
  readonly banned: false;
  readonly twoFactorEnabled: boolean;
  readonly twoFactorStatus: Readonly<{ isEnabled: boolean }>;
  readonly partialLogin?: true;
}

export type AuthenticationResult =
  | { readonly kind: 'authenticated'; readonly user: AuthenticatedUser }
  | { readonly kind: 'missing-token' }
  | { readonly kind: 'invalid-token-format' }
  | { readonly kind: 'invalid-token' }
  | { readonly kind: 'expired-token' }
  | { readonly kind: 'user-not-found' }
  | { readonly kind: 'account-suspended' }
  | { readonly kind: 'unexpected' };
