import type { GoogleIdentity } from './authentication.types.js';

export interface GoogleIdentityProvider {
  isConfigured(): boolean;
  createAuthorizationUrl(): string;
  exchangeAuthorizationCode(code: string): Promise<GoogleIdentity>;
  verifyIdToken(idToken: string): Promise<GoogleIdentity>;
}

export const GOOGLE_IDENTITY_PROVIDER = Symbol('GOOGLE_IDENTITY_PROVIDER');
