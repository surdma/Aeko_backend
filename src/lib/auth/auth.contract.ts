import type { AppConfig } from '../../configuration/configuration/configuration.service';

export const AEKO_AUTH_CONTRACT = Object.freeze({
  appName: 'Aeko',
  basePath: '/api/auth',
  databaseProvider: 'postgresql',
  nativeOwner: '/api/auth/**',
  models: Object.freeze({
    user: 'User',
    session: 'Session',
    account: 'Account',
    verification: 'Verification',
  }),
} as const);

export interface AekoAuthSettings {
  readonly baseURL: string;
  readonly secret: string;
  readonly trustedOrigins: readonly string[];
  readonly secureCookies: boolean;
  readonly google?: {
    readonly clientId: string;
    readonly clientSecret: string;
  };
}

export interface AekoEmailPasswordPolicy {
  readonly disableSignUp: boolean;
  readonly requireEmailVerification: boolean;
}

export function resolveAekoAuthSettings(
  configuration: AppConfig,
): AekoAuthSettings {
  const googleClientId = configuration.providerCredentials.googleClientId;
  const googleClientSecret =
    configuration.providerCredentials.googleClientSecret;
  return Object.freeze({
    baseURL: configuration.betterAuthUrl,
    secret: configuration.betterAuthSecret,
    trustedOrigins: Object.freeze([...configuration.trustedOrigins]),
    secureCookies: configuration.nodeEnv === 'production',
    ...(googleClientId && googleClientSecret
      ? {
          google: Object.freeze({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        }
      : {}),
  });
}

export function resolveEmailPasswordPolicy(
  hasEmailPort: boolean,
): AekoEmailPasswordPolicy {
  return Object.freeze({
    disableSignUp: !hasEmailPort,
    requireEmailVerification: hasEmailPort,
  });
}
