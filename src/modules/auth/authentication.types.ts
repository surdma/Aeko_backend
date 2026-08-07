export interface AuthenticationAccount {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly avatar: string | null;
  readonly profilePicture: string | null;
  readonly bio: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
  readonly banned: boolean;
  readonly isAdmin: boolean;
  readonly emailVerification: unknown;
  readonly profileCompletion: unknown;
  readonly twoFactorAuth: unknown;
  readonly oauthProvider: string | null;
  readonly oauthId: string | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
}

export interface GoogleIdentity {
  readonly providerId: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly photo: string | null;
}

export interface AuthTokenCookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly maxAge?: number;
}

export interface AuthenticationUserView {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly email: string;
  readonly profilePicture: string | null;
  readonly avatar?: string | null;
  readonly bio: string | null;
  readonly blueTick: boolean;
  readonly goldenTick?: boolean;
  readonly emailVerification: Readonly<{ isVerified: boolean | undefined }>;
  readonly profileCompletion: unknown;
  readonly isAdmin?: boolean;
  readonly oauthProvider?: string | null;
  readonly lastLoginAt?: Date | null;
  readonly createdAt?: Date;
  readonly twoFactorEnabled?: boolean;
}

export type CreateAccountResult =
  | { readonly kind: 'created'; readonly account: AuthenticationAccount }
  | { readonly kind: 'duplicate-email' }
  | { readonly kind: 'duplicate-username' };

export type SignupResult =
  | {
      readonly kind: 'created';
      readonly userId: string;
      readonly emailSent: boolean;
      readonly verificationCode: string;
    }
  | { readonly kind: 'duplicate-email' }
  | { readonly kind: 'duplicate-username' }
  | { readonly kind: 'unexpected' };

export type VerifyEmailResult =
  | { readonly kind: 'verified'; readonly token: string; readonly user: AuthenticationUserView }
  | { readonly kind: 'user-not-found' }
  | { readonly kind: 'already-verified' }
  | { readonly kind: 'missing-code' }
  | { readonly kind: 'expired-code' }
  | { readonly kind: 'too-many-attempts' }
  | { readonly kind: 'invalid-code' }
  | { readonly kind: 'unexpected' };

export type ResendVerificationResult =
  | {
      readonly kind: 'sent';
      readonly emailSent: boolean;
      readonly verificationCode: string;
    }
  | { readonly kind: 'user-not-found' }
  | { readonly kind: 'already-verified' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unexpected' };

export type LoginResult =
  | { readonly kind: 'authenticated'; readonly token: string; readonly user: AuthenticationUserView }
  | { readonly kind: 'invalid-credentials' }
  | { readonly kind: 'email-not-verified'; readonly userId: string }
  | { readonly kind: 'account-suspended' }
  | { readonly kind: 'two-factor-required'; readonly userId: string }
  | { readonly kind: 'invalid-second-factor' }
  | { readonly kind: 'unexpected' };

export type GoogleAuthenticationResult =
  | { readonly kind: 'authenticated'; readonly token: string; readonly user: AuthenticationUserView }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'invalid-token' }
  | { readonly kind: 'unexpected' };

export type ProfileCompletionResult =
  | { readonly kind: 'found'; readonly profileCompletion: Readonly<Record<string, unknown>> }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unexpected' };

export type CurrentUserResult =
  | { readonly kind: 'found'; readonly user: AuthenticationUserView }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unexpected' };

export type ForgotPasswordResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'timed-out' }
  | { readonly kind: 'unexpected' };

export type ResetPasswordResult =
  | { readonly kind: 'reset' }
  | { readonly kind: 'invalid-token' }
  | { readonly kind: 'user-not-found' }
  | { readonly kind: 'unexpected' };
