import { createHash } from 'node:crypto';
import { expo } from '@better-auth/expo';
import { passkey } from '@better-auth/passkey';
import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { toNodeHandler } from 'better-auth/node';
import { bearer, twoFactor, username } from 'better-auth/plugins';
import type { RequestHandler } from 'express';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import {
  APP_CONFIGURATION,
  type AppConfiguration,
} from '../../config/configuration.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  AUTH_V1_EMAIL_SENDER,
  type AuthV1EmailMessage,
  type AuthV1EmailSender,
} from './auth-v1-email-sender.port.js';

export interface AuthV1SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
}

export interface AuthV1SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface AuthV1Session {
  readonly user: AuthV1SessionUser;
  readonly session: AuthV1SessionRecord;
}

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

@Injectable()
export class BetterAuthV1Service {
  public readonly nodeHandler: RequestHandler;
  private readonly readSession: (headers: Headers) => Promise<AuthV1Session | null>;

  public constructor(
    @Inject(APP_CONFIGURATION)
    configuration: AppConfiguration,
    prisma: PrismaService,
    @Inject(AUTH_V1_EMAIL_SENDER)
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

    const auth = betterAuth({
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

    this.nodeHandler = toNodeHandler(auth);
    this.readSession = async (headers) => {
      const resolved = await auth.api.getSession({ headers });
      if (resolved === null) return null;
      return {
        user: {
          id: resolved.user.id,
          name: resolved.user.name,
          email: resolved.user.email,
          emailVerified: resolved.user.emailVerified,
          image: resolved.user.image ?? null,
        },
        session: {
          id: resolved.session.id,
          userId: resolved.session.userId,
          expiresAt: resolved.session.expiresAt,
        },
      };
    };
  }

  public getSession(headers: Headers): Promise<AuthV1Session | null> {
    return this.readSession(headers);
  }
}
