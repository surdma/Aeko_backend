import { createHash } from 'node:crypto';
import { expo } from '@better-auth/expo';
import { passkey } from '@better-auth/passkey';
import bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, twoFactor, username } from 'better-auth/plugins';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import type { AppConfiguration } from '../../config/configuration.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  AuthV1EmailMessage,
  AuthV1EmailSender,
} from './auth-v1-email-sender.port.js';

export const BETTER_AUTH_V1 = Symbol('BETTER_AUTH_V1');

function messageKey(purpose: string, ownerId: string, secretValue: string): string {
  const digest = createHash('sha256').update(secretValue).digest('hex').slice(0, 32);
  return `${purpose}/${ownerId}/${digest}`;
}

function scheduleEmail(
  sender: AuthV1EmailSender,
  logger: SanitizedLogger,
  message: AuthV1EmailMessage,
): void {
  void sender.send(message).catch((error: unknown) => {
    logger.error('Better Auth email dispatch failed', {
      purpose: message.subject,
      error,
    });
  });
}

export function createAekoBetterAuth(
  configuration: AppConfiguration,
  prisma: PrismaService,
  emailSender: AuthV1EmailSender,
  logger: SanitizedLogger,
) {
  const google = configuration.betterAuth.google;
  const socialProviders = google.configured
    ? {
        google: {
          clientId: google.clientId,
          clientSecret: google.clientSecret,
        },
      }
    : undefined;

  return betterAuth({
    appName: 'Aeko',
    basePath: '/api/auth',
    baseURL: configuration.betterAuth.url,
    secret: configuration.betterAuth.secret,
    trustedOrigins: [...configuration.betterAuth.trustedOrigins],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    user: { modelName: 'AuthUser' },
    session: { modelName: 'AuthSession' },
    account: {
      modelName: 'AuthAccount',
      accountLinking: { disableImplicitLinking: true },
    },
    verification: { modelName: 'AuthVerification' },
    ...(socialProviders === undefined ? {} : { socialProviders }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: async (password) => bcrypt.hash(password, 12),
        verify: async ({ hash, password }) => bcrypt.compare(password, hash),
      },
      sendResetPassword: async ({ user, url, token }) => {
        scheduleEmail(emailSender, logger, {
          to: user.email,
          subject: 'Reset your Aeko password',
          text: `Use this secure link to reset your Aeko password: ${url}`,
          idempotencyKey: messageKey('password-reset', user.id, token),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url, token }) => {
        scheduleEmail(emailSender, logger, {
          to: user.email,
          subject: 'Verify your Aeko email',
          text: `Verify your Aeko email using this secure link: ${url}`,
          idempotencyKey: messageKey('email-verification', user.id, token),
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await prisma.profile.upsert({
              where: { userId: user.id },
              create: { userId: user.id },
              update: {},
            });
          },
        },
      },
    },
    plugins: [
      username(),
      twoFactor({
        issuer: 'Aeko',
        allowPasswordless: true,
        otpOptions: {
          sendOTP: async ({ user, otp }) => {
            scheduleEmail(emailSender, logger, {
              to: user.email,
              subject: 'Your Aeko verification code',
              text: `Your Aeko verification code is ${otp}.`,
              idempotencyKey: messageKey('two-factor-otp', user.id, otp),
            });
          },
        },
        schema: { twoFactor: { modelName: 'AuthTwoFactor' } },
      }),
      passkey({
        rpID: configuration.betterAuth.passkey.rpId,
        rpName: configuration.betterAuth.passkey.rpName,
        origin: configuration.betterAuth.passkey.origin,
        schema: { passkey: { modelName: 'AuthPasskey' } },
      }),
      bearer({ requireSignature: true }),
      expo(),
    ],
  });
}

export type AekoBetterAuth = ReturnType<typeof createAekoBetterAuth>;
