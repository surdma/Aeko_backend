import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type {
  AuthenticationAccount,
  AuthenticationUserView,
} from './authentication.types.js';

export const emailVerificationSchema = z
  .object({
    isVerified: z.boolean().optional(),
    verificationCode: z.string().nullable().optional(),
    codeExpiresAt: z.union([z.string(), z.date()]).nullable().optional(),
    codeAttempts: z.number().int().nonnegative().optional(),
    lastCodeSent: z.union([z.string(), z.date()]).nullable().optional(),
  })
  .passthrough();

export const profileCompletionSchema = z
  .object({
    hasProfilePicture: z.boolean().optional(),
    hasBio: z.boolean().optional(),
    hasFollowers: z.boolean().optional(),
    hasVerifiedEmail: z.boolean().optional(),
    completionPercentage: z.number().optional(),
  })
  .passthrough();

const backupCodeSchema = z.object({
  code: z.string(),
  used: z.boolean().default(false),
  usedAt: z.union([z.string(), z.date()]).nullable().optional(),
});

export const twoFactorStateSchema = z
  .object({
    isEnabled: z.boolean().default(false),
    backupCodes: z.array(backupCodeSchema).default([]),
  })
  .passthrough();

export const resetTokenSchema = z.object({ userId: z.string().min(1) }).passthrough();

export function dateFromUnknown(value: string | Date | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createVerificationCode(): string {
  return randomInt(1000, 10_000).toString();
}

export function normalizeUsernameBase(value: string): string {
  const normalized = value.replace(/\s+/gu, '').toLowerCase();
  return normalized.length > 0 ? normalized : 'user';
}

export function accountUserView(
  account: AuthenticationAccount,
  options: Readonly<{
    avatar?: boolean;
    goldenTick?: boolean;
    admin?: boolean;
    oauth?: boolean;
    dates?: boolean;
    twoFactorEnabled?: boolean;
  }> = {},
): AuthenticationUserView {
  const verification = emailVerificationSchema.safeParse(account.emailVerification);
  const twoFactor = twoFactorStateSchema.safeParse(account.twoFactorAuth);
  return {
    id: account.id,
    name: account.name,
    username: account.username,
    email: account.email,
    profilePicture: account.profilePicture,
    bio: account.bio,
    blueTick: account.blueTick,
    emailVerification: {
      isVerified: verification.success ? verification.data.isVerified : undefined,
    },
    profileCompletion: account.profileCompletion,
    ...(options.avatar === true ? { avatar: account.avatar } : {}),
    ...(options.goldenTick === true ? { goldenTick: account.goldenTick } : {}),
    ...(options.admin === true ? { isAdmin: account.isAdmin } : {}),
    ...(options.oauth === true ? { oauthProvider: account.oauthProvider } : {}),
    ...(options.dates === true
      ? { lastLoginAt: account.lastLoginAt, createdAt: account.createdAt }
      : {}),
    ...(options.twoFactorEnabled === true
      ? { twoFactorEnabled: twoFactor.success && twoFactor.data.isEnabled }
      : {}),
  };
}
