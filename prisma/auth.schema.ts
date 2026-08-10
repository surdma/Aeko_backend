/**
 * Schema-generation input for the Better Auth CLI, whose unedited output is
 * `prisma/better-auth.generated.prisma`.
 *
 * This is NOT the runtime auth configuration — that is
 * `src/lib/auth/auth.config.ts`, which receives the application's single
 * Prisma client. This file constructs its own client and a placeholder secret
 * at import time, so it lives outside `src/` and never reaches the build.
 */
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { bearer, twoFactor } from 'better-auth/plugins';
import { PrismaClient } from './generated/client';

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://schema:only@127.0.0.1:9/aeko_schema';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

export const auth = betterAuth({
  appName: 'Aeko',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  secret:
    process.env.BETTER_AUTH_SECRET ??
    'aeko-schema-generation-only-secret-not-for-runtime-use',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        },
      }
    : {}),
  plugins: [bearer(), twoFactor()],
});
