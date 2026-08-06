import { Global, Module, type DynamicModule } from '@nestjs/common';
import { z } from 'zod';

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
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  HTTP_BODY_LIMIT: z.string().min(1).default('10mb'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(1).default(1),
  LOG_LEVEL: z.enum(['debug', 'log', 'warn', 'error', 'fatal']).default('log'),
  JWT_SECRET: z.string().min(16),
  TWO_FACTOR_SECRET_KEY: z.string().min(32),
});

export type RuntimeEnvironment = z.infer<typeof environmentSchema>;

export interface AppConfiguration {
  readonly app: {
    readonly environment: RuntimeEnvironment['NODE_ENV'];
    readonly host: string;
    readonly port: number;
  };
  readonly database: {
    readonly url: string;
  };
  readonly http: {
    readonly bodyLimit: string;
    readonly corsOrigins: readonly string[];
    readonly trustProxy: 0 | 1;
  };
  readonly logging: {
    readonly level: RuntimeEnvironment['LOG_LEVEL'];
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly twoFactorSecretKey: string;
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
    },
  };

  return Object.freeze({
    ...configuration,
    app: Object.freeze(configuration.app),
    database: Object.freeze(configuration.database),
    http: Object.freeze(configuration.http),
    logging: Object.freeze(configuration.logging),
    auth: Object.freeze(configuration.auth),
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
