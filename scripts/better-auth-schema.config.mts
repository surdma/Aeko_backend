import { expo } from '@better-auth/expo';
import { passkey } from '@better-auth/passkey';
import { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, twoFactor, username } from 'better-auth/plugins';

const prisma = new PrismaClient();

export const auth = betterAuth({
  appName: 'Aeko',
  basePath: '/api/auth',
  baseURL: 'http://127.0.0.1:9876',
  secret: 'schema-generation-only-secret-with-at-least-thirty-two-characters',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  plugins: [
    username(),
    twoFactor({ issuer: 'Aeko', allowPasswordless: true }),
    passkey({
      rpID: 'localhost',
      rpName: 'Aeko',
      origin: 'http://localhost:9876',
    }),
    bearer({ requireSignature: true }),
    expo(),
  ],
});
