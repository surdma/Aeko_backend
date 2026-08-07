import type {
  AuthenticationAccount,
  CreateAccountResult,
} from './authentication.types.js';

export interface CreateCredentialAccountInput {
  readonly name: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly verificationCode: string;
  readonly verificationExpiresAt: string;
  readonly now: string;
}

export interface CreateGoogleAccountInput {
  readonly name: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly oauthId: string;
  readonly avatar: string;
}

export interface AuthenticationRepository {
  findById(userId: string): Promise<AuthenticationAccount | null>;
  findByEmail(email: string): Promise<AuthenticationAccount | null>;
  findByUsername(username: string): Promise<AuthenticationAccount | null>;
  findByEmailOrUsername(
    email: string,
    username: string,
  ): Promise<AuthenticationAccount | null>;
  findByGoogleIdentity(oauthId: string): Promise<AuthenticationAccount | null>;
  createCredentialAccount(
    input: CreateCredentialAccountInput,
  ): Promise<CreateAccountResult>;
  createGoogleAccount(input: CreateGoogleAccountInput): Promise<CreateAccountResult>;
  updateVerificationState(
    userId: string,
    emailVerification: Readonly<Record<string, unknown>>,
    profileCompletion?: Readonly<Record<string, unknown>>,
  ): Promise<AuthenticationAccount>;
  linkGoogleIdentity(
    userId: string,
    oauthId: string,
    avatar: string,
    emailVerification: Readonly<Record<string, unknown>>,
  ): Promise<AuthenticationAccount>;
  updateGoogleLogin(
    userId: string,
    lastLoginAt: Date,
    avatar?: string,
  ): Promise<AuthenticationAccount>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
}

export const AUTHENTICATION_REPOSITORY = Symbol('AUTHENTICATION_REPOSITORY');
