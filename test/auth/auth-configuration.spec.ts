import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from '../../src/configuration/configuration/configuration.service';
import {
  AEKO_AUTH_CONTRACT,
  resolveAekoAuthSettings,
  resolveEmailPasswordPolicy,
} from '../../src/lib/auth/auth.contract';
import { createAuthEmailCallbacks } from '../../src/lib/auth/auth-email.callbacks';
import type { AuthEmailPort } from '../../src/lib/auth/auth-email.port';
import { PrismaService } from '../../src/database/prisma/prisma.service';

const workspace = resolve(__dirname, '..', '..');

const baseConfiguration: AppConfig = Object.freeze({
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: 'postgresql://aeko:test@localhost:5432/aeko_test',
  betterAuthSecret: 'test-secret-with-at-least-thirty-two-characters',
  betterAuthUrl: 'http://localhost:3000',
  trustedOrigins: Object.freeze([
    'http://localhost:3001',
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aeko://',
  ]),
  proxyHops: 0,
  providerCredentials: Object.freeze({}),
});

class RecordingEmailPort implements AuthEmailPort {
  readonly messages: Array<{
    readonly kind: 'email-verification' | 'password-reset';
    readonly recipient: string;
    readonly url: string;
  }> = [];

  deliver(message: {
    readonly kind: 'email-verification' | 'password-reset';
    readonly recipient: string;
    readonly url: string;
  }): Promise<void> {
    this.messages.push(Object.freeze({ ...message }));
    return Promise.resolve();
  }
}

describe('native Aeko Better Auth configuration', () => {
  it('uses the canonical app, endpoint, adapter, and ORM model names', () => {
    expect(AEKO_AUTH_CONTRACT).toMatchObject({
      appName: 'Aeko',
      basePath: '/api/auth',
      databaseProvider: 'postgresql',
      nativeOwner: '/api/auth/**',
      models: {
        user: 'User',
        session: 'Session',
        account: 'Account',
        verification: 'Verification',
      },
    });
    expect(resolveAekoAuthSettings(baseConfiguration)).toMatchObject({
      baseURL: 'http://localhost:3000',
      trustedOrigins: baseConfiguration.trustedOrigins,
      secureCookies: false,
    });
  });

  it('enables native password, bearer, and two-factor behavior securely', () => {
    const source = readFileSync(
      resolve(workspace, 'src/lib/auth/auth.config.ts'),
      'utf8',
    );

    expect(source).toMatch(/emailAndPassword:\s*\{[\s\S]*enabled:\s*true/);
    expect(resolveEmailPasswordPolicy(false)).toEqual({
      disableSignUp: true,
      requireEmailVerification: false,
    });
    expect(resolveEmailPasswordPolicy(true)).toEqual({
      disableSignUp: false,
      requireEmailVerification: true,
    });
    expect(source).toMatch(/revokeSessionsOnPasswordReset:\s*true/);
    expect(source).toMatch(/plugins:\s*\[bearer\(\),\s*twoFactor\(/);
    expect(source).toMatch(/disableCSRFCheck:\s*false/);
    expect(source).toMatch(/disableOriginCheck:\s*false/);
    expect(source).not.toMatch(/password:\s*\{\s*(?:hash|verify)/);
  });

  it('enables Google only when both validated credentials exist', () => {
    const withoutGoogle = resolveAekoAuthSettings(baseConfiguration);
    const withGoogle = resolveAekoAuthSettings({
      ...baseConfiguration,
      providerCredentials: Object.freeze({
        googleClientId: 'google-client-id',
        googleClientSecret: 'google-client-secret',
      }),
    });

    expect(withoutGoogle.google).toBeUndefined();
    expect(withGoogle.google).toEqual({
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
    });
  });

  it('uses secure production cookies and typed delivery callbacks', async () => {
    const email = new RecordingEmailPort();
    const settings = resolveAekoAuthSettings({
      ...baseConfiguration,
      nodeEnv: 'production',
    });
    const callbacks = createAuthEmailCallbacks(email);

    expect(settings.secureCookies).toBe(true);
    await callbacks.sendVerificationEmail({
      user: { email: 'user@example.com' },
      url: 'https://aeko.example/verify?token=opaque',
    });
    await callbacks.sendResetPassword({
      user: { email: 'user@example.com' },
      url: 'https://aeko.example/reset?token=opaque',
    });

    expect(email.messages).toEqual([
      {
        kind: 'email-verification',
        recipient: 'user@example.com',
        url: 'https://aeko.example/verify?token=opaque',
      },
      {
        kind: 'password-reset',
        recipient: 'user@example.com',
        url: 'https://aeko.example/reset?token=opaque',
      },
    ]);
  });

  it('reuses the lifecycle-owned Prisma client and mounts auth before parsers', () => {
    const client = {
      $connect: (): Promise<void> => Promise.resolve(),
      $disconnect: (): Promise<void> => Promise.resolve(),
      $queryRaw: (): Promise<unknown> => Promise.resolve([]),
    };
    expect(new PrismaService(client).adapterClient).toBe(client);

    const mainSource = readFileSync(resolve(workspace, 'src/main.ts'), 'utf8');
    const handlerIndex = mainSource.indexOf('toNodeHandler');
    const jsonParserIndex = mainSource.indexOf("useBodyParser('json'");
    expect(handlerIndex).toBeGreaterThan(-1);
    expect(jsonParserIndex).toBeGreaterThan(handlerIndex);
    expect(mainSource).toMatch(
      /pathname === '\/api\/auth' \|\| pathname\.startsWith\('\/api\/auth\/'\)/,
    );
    const databaseSource = readFileSync(
      resolve(workspace, 'src/database/database.module.ts'),
      'utf8',
    );
    expect(databaseSource).toContain(
      "import('../../prisma/generated/client.js')",
    );
    expect(databaseSource).not.toContain(
      "import('../../../prisma/generated/client.js')",
    );
  });

  it('contains no legacy or compatibility auth implementation', () => {
    const sourceFiles = [
      'src/auth/auth.module.ts',
      'src/lib/auth/auth.config.ts',
      'src/lib/auth/auth.contract.ts',
      'src/lib/auth/auth-email.callbacks.ts',
      'src/lib/auth/auth-email.port.ts',
    ].map((file) => readFileSync(resolve(workspace, file), 'utf8'));
    const source = sourceFiles.join('\n');

    expect(source).not.toMatch(
      /express\.Router|passport|jsonwebtoken|\bbcrypt\b|verificationCode|resetPasswordToken|compatibility controller|legacy payload/i,
    );
    const packageJson = readFileSync(
      resolve(workspace, 'package.json'),
      'utf8',
    );
    expect(packageJson).not.toMatch(/"(?:bcrypt|@types\/bcrypt|jose)"\s*:/);
  });
});
