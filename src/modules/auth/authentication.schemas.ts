import { z } from 'zod';

const requiredString = z.string().min(1);

export const signupSchema = z.object({
  name: requiredString,
  username: requiredString,
  email: requiredString,
  password: requiredString,
});

export const verifyEmailSchema = z.object({
  userId: requiredString,
  verificationCode: requiredString,
});

export const resendVerificationSchema = z.object({ userId: requiredString });

export const loginSchema = z.object({
  email: requiredString,
  password: requiredString,
  twoFactorToken: requiredString.optional(),
  backupCode: requiredString.optional(),
});

export const mobileGoogleProfileSchema = z.object({
  name: requiredString.optional(),
  email: requiredString.optional(),
  photo: requiredString.optional(),
});

export const mobileGoogleSchema = z.object({
  idToken: requiredString,
  user: mobileGoogleProfileSchema.optional(),
});

export const forgotPasswordSchema = z.object({ email: requiredString });
export const resetPasswordSchema = z.object({ token: requiredString, newPassword: requiredString });

export type SignupInput = z.infer<typeof signupSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MobileGoogleInput = z.infer<typeof mobileGoogleSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
