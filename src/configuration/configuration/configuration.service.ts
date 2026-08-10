import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ProviderCredentials {
  readonly googleClientId?: string;
  readonly googleClientSecret?: string;
  readonly resendApiKey?: string;
  readonly cloudinaryCloudName?: string;
  readonly cloudinaryApiKey?: string;
  readonly cloudinaryApiSecret?: string;
}

export interface AppConfig {
  readonly nodeEnv: NodeEnvironment;
  readonly port: number;
  readonly databaseUrl: string;
  readonly betterAuthSecret: string;
  readonly betterAuthUrl: string;
  readonly trustedOrigins: readonly string[];
  readonly proxyHops: number;
  /**
   * Absent means realtime notification delivery is disabled: the REST inbox is
   * unaffected and the SSE stream reports the capability as unavailable rather
   * than opening a connection that would never emit.
   */
  readonly redisUrl: string | null;
  readonly providerCredentials: ProviderCredentials;
}

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.url().refine((value) => value.startsWith('postgresql://'), {
      message: 'must be a PostgreSQL URL',
    }),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().default(''),
    TRUST_PROXY: z.preprocess(
      (value) => (value === 'none' ? 0 : value),
      z.coerce.number().int().min(0).max(10).default(0),
    ),
    BETTER_AUTH_GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
    BETTER_AUTH_GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    CLOUDINARY_CLOUD_NAME: z.string().trim().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().trim().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().trim().min(1).optional(),
    REDIS_URL: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) =>
          value.startsWith('redis://') || value.startsWith('rediss://'),
        { message: 'must be a redis:// or rediss:// URL' },
      )
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      Boolean(value.BETTER_AUTH_GOOGLE_CLIENT_ID) !==
      Boolean(value.BETTER_AUTH_GOOGLE_CLIENT_SECRET)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_GOOGLE_CLIENT_ID'],
        message: 'Google credentials must be configured together',
      });
    }
    const cloudinaryValues = [
      value.CLOUDINARY_CLOUD_NAME,
      value.CLOUDINARY_API_KEY,
      value.CLOUDINARY_API_SECRET,
    ];
    const configuredCloudinaryValues = cloudinaryValues.filter(Boolean).length;
    if (configuredCloudinaryValues > 0 && configuredCloudinaryValues < 3) {
      context.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_CLOUD_NAME'],
        message: 'Cloudinary credentials must be configured together',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      !value.BETTER_AUTH_URL.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'must use HTTPS in production',
      });
    }
  });

export function loadAppConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.map(
          (issue) => issue.path.join('.') || 'environment',
        ),
      ),
    ].sort();
    throw new Error(`Invalid application configuration: ${fields.join(', ')}`);
  }

  const trustedOrigins = parseTrustedOrigins(
    parsed.data.BETTER_AUTH_TRUSTED_ORIGINS,
    parsed.data.NODE_ENV,
  );
  const providerCredentials = Object.freeze({
    ...(parsed.data.BETTER_AUTH_GOOGLE_CLIENT_ID
      ? { googleClientId: parsed.data.BETTER_AUTH_GOOGLE_CLIENT_ID }
      : {}),
    ...(parsed.data.BETTER_AUTH_GOOGLE_CLIENT_SECRET
      ? { googleClientSecret: parsed.data.BETTER_AUTH_GOOGLE_CLIENT_SECRET }
      : {}),
    ...(parsed.data.RESEND_API_KEY
      ? { resendApiKey: parsed.data.RESEND_API_KEY }
      : {}),
    ...(parsed.data.CLOUDINARY_CLOUD_NAME
      ? { cloudinaryCloudName: parsed.data.CLOUDINARY_CLOUD_NAME }
      : {}),
    ...(parsed.data.CLOUDINARY_API_KEY
      ? { cloudinaryApiKey: parsed.data.CLOUDINARY_API_KEY }
      : {}),
    ...(parsed.data.CLOUDINARY_API_SECRET
      ? { cloudinaryApiSecret: parsed.data.CLOUDINARY_API_SECRET }
      : {}),
  });

  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    betterAuthSecret: parsed.data.BETTER_AUTH_SECRET,
    betterAuthUrl: normalizeOrigin(
      parsed.data.BETTER_AUTH_URL,
      parsed.data.NODE_ENV,
    ),
    trustedOrigins: Object.freeze(trustedOrigins),
    proxyHops: parsed.data.TRUST_PROXY,
    redisUrl: parsed.data.REDIS_URL ?? null,
    providerCredentials,
  });
}

function parseTrustedOrigins(
  value: string,
  environment: NodeEnvironment,
): readonly string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => normalizeOrigin(origin, environment));
  return [...new Set(origins)];
}

function normalizeOrigin(value: string, environment: NodeEnvironment): string {
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(value)) {
    return value;
  }
  if (value === 'aeko://') {
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid application configuration: trusted origin');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid application configuration: trusted origin');
  }
  if (environment === 'production' && url.protocol !== 'https:') {
    throw new Error('Invalid application configuration: trusted origin');
  }
  return url.origin;
}

@Injectable()
export class ConfigurationService {
  constructor(@Inject(APP_CONFIG) private readonly configuration: AppConfig) {}

  get value(): AppConfig {
    return this.configuration;
  }

  /** Null disables realtime notification delivery; REST is unaffected. */
  get redisUrl(): string | null {
    return this.configuration.redisUrl;
  }
}
