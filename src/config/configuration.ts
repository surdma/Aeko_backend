import { Global, Module, type DynamicModule } from '@nestjs/common';
import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(9876),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must use the PostgreSQL protocol',
    ),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  HTTP_BODY_LIMIT: z.string().min(1).default('10mb'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(1).default(1),
  LOG_LEVEL: z.enum(['debug', 'log', 'warn', 'error', 'fatal']).default('log'),
  JWT_SECRET: z.string().min(16),
  TWO_FACTOR_SECRET_KEY: z.string().min(32),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_CALLBACK_URL: optionalString,
  OAUTH_FAILURE_REDIRECT: z.string().min(1).default('aeko://auth/failed'),
  ZEPTOMAIL_API_URL: optionalString,
  ZEPTOMAIL_API_KEY: optionalString,
  EMAIL_SENDER_NAME: z.string().min(1).default('Aeko'),
  BETTER_AUTH_SECRET: optionalString,
  BETTER_AUTH_URL: optionalString,
  BETTER_AUTH_TRUSTED_ORIGINS: optionalString,
  BETTER_AUTH_GOOGLE_CLIENT_ID: optionalString,
  BETTER_AUTH_GOOGLE_CLIENT_SECRET: optionalString,
  BETTER_AUTH_PASSKEY_RP_ID: optionalString,
  BETTER_AUTH_PASSKEY_RP_NAME: z.string().min(1).default('Aeko'),
  BETTER_AUTH_PASSKEY_ORIGIN: optionalString,
  BETTER_AUTH_EXPO_SCHEME: z.string().min(1).default('aeko'),
  RESEND_API_KEY: optionalString,
  RESEND_FROM: optionalString,
  AUTH_EMAIL_OUTBOX_PATH: optionalString,
});

export type RuntimeEnvironment = z.infer<typeof environmentSchema>;

type OptionalProviderConfiguration =
  | Readonly<{ configured: false; clientId: null; clientSecret: null }>
  | Readonly<{ configured: true; clientId: string; clientSecret: string }>;

type OptionalEmailProviderConfiguration =
  | Readonly<{ configured: false; apiKey: null; from: null }>
  | Readonly<{ configured: true; apiKey: string; from: string }>;

export interface AppConfiguration {
  readonly app: {
    readonly environment: RuntimeEnvironment['NODE_ENV'];
    readonly host: string;
    readonly port: number;
  };
  readonly database: { readonly url: string };
  readonly http: {
    readonly bodyLimit: string;
    readonly corsOrigins: readonly string[];
    readonly trustProxy: 0 | 1;
  };
  readonly logging: { readonly level: RuntimeEnvironment['LOG_LEVEL'] };
  readonly auth: {
    readonly jwtSecret: string;
    readonly twoFactorSecretKey: string;
    readonly frontendUrl: string;
    readonly google: {
      readonly clientId: string | null;
      readonly clientSecret: string | null;
      readonly callbackUrl: string | null;
      readonly failureRedirect: string;
    };
  };
  readonly betterAuth: {
    readonly secret: string;
    readonly url: string;
    readonly trustedOrigins: readonly string[];
    readonly google: OptionalProviderConfiguration;
    readonly passkey: {
      readonly rpId: string;
      readonly rpName: string;
      readonly origin: string;
    };
    readonly expoScheme: string;
    readonly resend: OptionalEmailProviderConfiguration;
    readonly emailOutboxPath?: string | null;
  };
  readonly email: {
    readonly zeptoMailApiUrl: string | null;
    readonly zeptoMailApiKey: string | null;
    readonly senderName: string;
  };
}

export const APP_CONFIGURATION = Symbol('APP_CONFIGURATION');

export class ConfigurationValidationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super(`Invalid application configuration: ${issues.join('; ')}`);
    this.name = 'ConfigurationValidationError';
  }
}

function normalizeTrustProxy(value: number): 0 | 1 {
  if (value === 0 || value === 1) return value;
  throw new ConfigurationValidationError(['TRUST_PROXY must be 0 or 1']);
}

function normalizeOrigins(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

function optional(value: string | undefined): string | null {
  return value ?? null;
}

function requireProductionValue(
  value: string | undefined,
  environment: RuntimeEnvironment['NODE_ENV'],
  name: string,
  developmentFallback: string,
): string {
  if (value !== undefined) return value;
  if (environment === 'production') {
    throw new ConfigurationValidationError([`${name} is required in production`]);
  }
  return developmentFallback;
}

function optionalProvider(
  clientId: string | undefined,
  clientSecret: string | undefined,
  prefix: string,
): OptionalProviderConfiguration {
  if (clientId === undefined && clientSecret === undefined) {
    return Object.freeze({ configured: false, clientId: null, clientSecret: null });
  }
  if (clientId === undefined || clientSecret === undefined) {
    throw new ConfigurationValidationError([
      `${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be configured together`,
    ]);
  }
  return Object.freeze({ configured: true, clientId, clientSecret });
}

function emailProvider(
  apiKey: string | undefined,
  from: string | undefined,
  environment: RuntimeEnvironment['NODE_ENV'],
): OptionalEmailProviderConfiguration {
  if (apiKey === undefined && from === undefined) {
    if (environment === 'production') {
      throw new ConfigurationValidationError([
        'RESEND_API_KEY and RESEND_FROM are required in production',
      ]);
    }
    return Object.freeze({ configured: false, apiKey: null, from: null });
  }
  if (apiKey === undefined || from === undefined) {
    throw new ConfigurationValidationError([
      'RESEND_API_KEY and RESEND_FROM must be configured together',
    ]);
  }
  return Object.freeze({ configured: true, apiKey, from });
}

function nonProductionOutbox(
  path: string | undefined,
  environment: RuntimeEnvironment['NODE_ENV'],
): string | null {
  if (path === undefined) return null;
  if (environment === 'production') {
    throw new ConfigurationValidationError([
      'AUTH_EMAIL_OUTBOX_PATH is not allowed in production',
    ]);
  }
  return path;
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new ConfigurationValidationError([`${name} must be a valid absolute URL`]);
  }
}

export function loadConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): AppConfiguration {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new ConfigurationValidationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
      ),
    );
  }

  const google = Object.freeze({
    clientId: optional(parsed.data.GOOGLE_CLIENT_ID),
    clientSecret: optional(parsed.data.GOOGLE_CLIENT_SECRET),
    callbackUrl: optional(parsed.data.GOOGLE_CALLBACK_URL),
    failureRedirect: parsed.data.OAUTH_FAILURE_REDIRECT,
  });
  const betterAuthUrl = requireProductionValue(
    parsed.data.BETTER_AUTH_URL,
    parsed.data.NODE_ENV,
    'BETTER_AUTH_URL',
    `http://127.0.0.1:${parsed.data.PORT}`,
  );
  const betterAuthUrlObject = parseUrl(betterAuthUrl, 'BETTER_AUTH_URL');
  const passkeyOrigin = parsed.data.BETTER_AUTH_PASSKEY_ORIGIN ?? betterAuthUrl;
  parseUrl(passkeyOrigin, 'BETTER_AUTH_PASSKEY_ORIGIN');
  const betterAuth = {
    secret: requireProductionValue(
      parsed.data.BETTER_AUTH_SECRET,
      parsed.data.NODE_ENV,
      'BETTER_AUTH_SECRET',
      'development-better-auth-secret-with-at-least-thirty-two-characters',
    ),
    url: betterAuthUrl,
    trustedOrigins: normalizeOrigins(
      parsed.data.BETTER_AUTH_TRUSTED_ORIGINS ?? parsed.data.CORS_ORIGINS,
    ),
    google: optionalProvider(
      parsed.data.BETTER_AUTH_GOOGLE_CLIENT_ID,
      parsed.data.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
      'BETTER_AUTH_GOOGLE',
    ),
    passkey: Object.freeze({
      rpId: parsed.data.BETTER_AUTH_PASSKEY_RP_ID ?? betterAuthUrlObject.hostname,
      rpName: parsed.data.BETTER_AUTH_PASSKEY_RP_NAME,
      origin: passkeyOrigin,
    }),
    expoScheme: parsed.data.BETTER_AUTH_EXPO_SCHEME,
    resend: emailProvider(
      parsed.data.RESEND_API_KEY,
      parsed.data.RESEND_FROM,
      parsed.data.NODE_ENV,
    ),
    emailOutboxPath: nonProductionOutbox(
      parsed.data.AUTH_EMAIL_OUTBOX_PATH,
      parsed.data.NODE_ENV,
    ),
  };
  const configuration: AppConfiguration = {
    app: {
      environment: parsed.data.NODE_ENV,
      host: parsed.data.HOST,
      port: parsed.data.PORT,
    },
    database: { url: parsed.data.DATABASE_URL },
    http: {
      bodyLimit: parsed.data.HTTP_BODY_LIMIT,
      corsOrigins: normalizeOrigins(parsed.data.CORS_ORIGINS),
      trustProxy: normalizeTrustProxy(parsed.data.TRUST_PROXY),
    },
    logging: { level: parsed.data.LOG_LEVEL },
    auth: {
      jwtSecret: parsed.data.JWT_SECRET,
      twoFactorSecretKey: parsed.data.TWO_FACTOR_SECRET_KEY,
      frontendUrl: parsed.data.FRONTEND_URL,
      google,
    },
    betterAuth,
    email: {
      zeptoMailApiUrl: optional(parsed.data.ZEPTOMAIL_API_URL),
      zeptoMailApiKey: optional(parsed.data.ZEPTOMAIL_API_KEY),
      senderName: parsed.data.EMAIL_SENDER_NAME,
    },
  };

  return Object.freeze({
    ...configuration,
    app: Object.freeze(configuration.app),
    database: Object.freeze(configuration.database),
    http: Object.freeze(configuration.http),
    logging: Object.freeze(configuration.logging),
    auth: Object.freeze(configuration.auth),
    betterAuth: Object.freeze(configuration.betterAuth),
    email: Object.freeze(configuration.email),
  });
}

@Global()
@Module({})
export class AppConfigurationModule {
  public static forRoot(
    environment: Readonly<Record<string, string | undefined>> = process.env,
  ): DynamicModule {
    return {
      module: AppConfigurationModule,
      global: true,
      providers: [
        {
          provide: APP_CONFIGURATION,
          useFactory: (): AppConfiguration => loadConfiguration(environment),
        },
      ],
      exports: [APP_CONFIGURATION],
    };
  }
}
