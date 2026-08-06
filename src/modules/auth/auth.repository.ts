import type { IdentityRecord } from './auth.types.js';

export interface SecurityRequestContext {
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface TwoFactorAuditInput extends SecurityRequestContext {
  readonly userId: string;
  readonly success: boolean;
  readonly errorMessage?: string;
}

export interface AuthRepository {
  findIdentityById(userId: string): Promise<IdentityRecord | null>;
  findTwoFactorState(userId: string): Promise<unknown>;
  updateTwoFactorState(userId: string, state: Readonly<Record<string, unknown>>): Promise<void>;
  recordTwoFactorUse(input: TwoFactorAuditInput): Promise<void>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
