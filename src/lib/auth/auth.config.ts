import type { BetterAuthOptions } from 'better-auth';
import type { AppConfig } from '../../configuration/configuration/configuration.service';
import {
  AEKO_AUTH_CONTRACT,
  resolveAekoAuthSettings,
  resolveEmailPasswordPolicy,
} from './auth.contract';
import { createAuthEmailCallbacks } from './auth-email.callbacks';
import type { AuthEmailPort } from './auth-email.port';

export async function createAekoAuth(
  prismaClient: object,
  configuration: AppConfig,
  emailPort?: AuthEmailPort,
) {
  const [{ prismaAdapter }, { betterAuth }, { bearer }, { twoFactor }] =
    await Promise.all([
      import('@better-auth/prisma-adapter'),
      import('better-auth'),
      import('better-auth/plugins/bearer'),
      import('better-auth/plugins/two-factor'),
    ]);
  const settings = resolveAekoAuthSettings(configuration);
  const emailCallbacks = emailPort
    ? createAuthEmailCallbacks(emailPort)
    : undefined;
  const emailPasswordPolicy = resolveEmailPasswordPolicy(Boolean(emailPort));
  const options: BetterAuthOptions = {
    appName: AEKO_AUTH_CONTRACT.appName,
    baseURL: settings.baseURL,
    basePath: AEKO_AUTH_CONTRACT.basePath,
    secret: settings.secret,
    trustedOrigins: [...settings.trustedOrigins],
    database: prismaAdapter(prismaClient, {
      provider: AEKO_AUTH_CONTRACT.databaseProvider,
    }),
    user: {
      modelName: 'User',
      deleteUser: { enabled: true },
      changeEmail: { enabled: Boolean(emailCallbacks) },
      additionalFields: {
        username: { type: 'string', required: true },
        isAdmin: {
          type: 'boolean',
          required: true,
          defaultValue: false,
          input: false,
        },
        banned: {
          type: 'boolean',
          required: true,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: { modelName: 'Session' },
    account: { modelName: 'Account' },
    verification: { modelName: 'Verification' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: emailPasswordPolicy.disableSignUp,
      requireEmailVerification: emailPasswordPolicy.requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      ...(emailCallbacks
        ? {
            sendResetPassword: emailCallbacks.sendResetPassword,
          }
        : {}),
    },
    ...(emailCallbacks
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: emailCallbacks.sendVerificationEmail,
          },
        }
      : {}),
    ...(settings.google
      ? {
          socialProviders: {
            google: {
              clientId: settings.google.clientId,
              clientSecret: settings.google.clientSecret,
            },
          },
        }
      : {}),
    advanced: {
      useSecureCookies: settings.secureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: settings.secureCookies,
      },
    },
    plugins: [bearer(), twoFactor({ issuer: AEKO_AUTH_CONTRACT.appName })],
  };
  return betterAuth(options);
}

export type AekoAuth = Awaited<ReturnType<typeof createAekoAuth>>;
