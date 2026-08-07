import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { waitForVerificationUrl } from './runtime-auth-email-outbox.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseUrl = `http://127.0.0.1:${process.env.PORT ?? '9876'}`;
const trustedOrigin = 'http://localhost:3000';
const outboxPath = `/tmp/aeko-auth-mode-${process.pid}.jsonl`;

interface RuntimeIdentity {
  readonly userId: string;
  readonly token: string;
}

interface IdentityTokens {
  readonly betterAuth: RuntimeIdentity;
  readonly v0: RuntimeIdentity;
}

function asObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new TypeError(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

async function request(
  method: string,
  path: string,
  options: Readonly<{ body?: unknown; token?: string }> = {},
): Promise<Response> {
  const headers = new Headers({ accept: 'application/json' });
  if (path.startsWith('/api/auth')) headers.set('origin', trustedOrigin);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token !== undefined) {
    headers.set('authorization', `Bearer ${options.token}`);
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    redirect: 'manual',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length === 0 ? null : (JSON.parse(text) as unknown);
}

async function expectStatus(
  method: string,
  path: string,
  status: number,
  options: Readonly<{ body?: unknown; token?: string }> = {},
): Promise<Response> {
  const response = await request(method, path, options);
  const body = await response.clone().text();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: expected ${status}, got ${response.status}: ${body}`,
  );
  process.stdout.write(`${method} ${path}: HTTP ${status}\n`);
  return response;
}

async function expectRejected(
  path: string,
  token?: string,
): Promise<void> {
  const response = await request('GET', path, token === undefined ? {} : { token });
  assert.ok(
    response.status === 401 || response.status === 403,
    `${path} unexpectedly accepted inactive auth: HTTP ${response.status}`,
  );
}

function runtimeEnvironment(mode: 'v0' | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    AUTH_EMAIL_OUTBOX_PATH: outboxPath,
  };
  if (mode === undefined) delete environment.AUTH_MODE;
  else environment.AUTH_MODE = mode;
  return environment;
}

function startServer(mode: 'v0' | undefined): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: root,
    env: runtimeEnvironment(mode),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  child.stdout.on('data', (chunk: Buffer) => {
    process.stdout.write(`[nest:${mode ?? 'default'}] ${chunk.toString()}`);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[nest:${mode ?? 'default'}] ${chunk.toString()}`);
  });
  return child;
}

async function waitForServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Nest exited with code ${child.exitCode}`);
    try {
      if ((await fetch(`${baseUrl}/health/live`)).status === 200) return;
    } catch {
      // Startup race.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('Nest did not become reachable within 30 seconds');
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((done) => child.once('exit', () => done())),
    new Promise<void>((done) =>
      setTimeout(() => {
        child.kill('SIGKILL');
        done();
      }, 5_000),
    ),
  ]);
}

async function createBetterAuthIdentity(
  suffix: string,
): Promise<RuntimeIdentity> {
  const email = `auth-mode-v1-${suffix}@example.com`;
  const password = 'auth-mode-better-password';
  const signup = asObject(
    await json(
      await expectStatus('POST', '/api/auth/sign-up/email', 200, {
        body: {
          name: 'Auth Mode Better User',
          username: `auth_mode_v1_${suffix}`.slice(0, 30),
          displayUsername: 'Auth Mode Better User',
          email,
          password,
        },
      }),
    ),
    'Better Auth signup',
  );
  const userId = requiredString(
    asObject(signup.user, 'Better Auth signup user'),
    'id',
    'Better Auth signup user',
  );

  const verificationUrl = await waitForVerificationUrl(email);
  const verification = await request(
    'GET',
    `${verificationUrl.pathname}${verificationUrl.search}`,
  );
  assert.ok(
    verification.status === 200 || verification.status === 302,
    `Better Auth verification failed with HTTP ${verification.status}`,
  );

  const login = await expectStatus('POST', '/api/auth/sign-in/email', 200, {
    body: { email, password },
  });
  const token = login.headers.get('set-auth-token');
  assert.ok(token !== null && token.length > 20, 'Better Auth bearer token is missing');
  return { userId, token };
}

async function createV0Identity(suffix: string): Promise<RuntimeIdentity> {
  const email = `auth-mode-v0-${suffix}@example.com`;
  const password = 'auth-mode-v0-password';
  const signup = asObject(
    await json(
      await expectStatus('POST', '/api/v0/auth/signup', 201, {
        body: {
          name: 'Auth Mode V0 User',
          username: `auth_mode_v0_${suffix}`.slice(0, 30),
          email,
          password,
        },
      }),
    ),
    'v0 signup',
  );
  const userId = requiredString(signup, 'userId', 'v0 signup');
  await expectStatus('POST', '/api/v0/auth/verify-email', 200, {
    body: {
      userId,
      verificationCode: requiredString(
        signup,
        'verificationCode',
        'v0 signup',
      ),
    },
  });
  const login = asObject(
    await json(
      await expectStatus('POST', '/api/v0/auth/login', 200, {
        body: { email, password },
      }),
    ),
    'v0 login',
  );
  return { userId, token: requiredString(login, 'token', 'v0 login') };
}

async function verifySse(identity: RuntimeIdentity): Promise<void> {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}/api/notifications/stream`, {
    headers: { Authorization: `Bearer ${identity.token}` },
    signal: abort.signal,
  });
  assert.equal(response.status, 200, `SSE returned HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/u);
  assert.ok(response.body !== null, 'SSE response body is missing');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true }).replaceAll('\r\n', '\n');
      if (buffer.includes('\n\n')) break;
    }
    assert.match(buffer, /event: connected/u);
    assert.ok(
      buffer.includes(identity.userId),
      'SSE connected event belongs to a different user',
    );
  } finally {
    abort.abort();
    await reader.cancel().catch(() => undefined);
  }
}

async function verifySelectedMode(
  prisma: PrismaClient,
  mode: 'better-auth' | 'v0',
  tokens: IdentityTokens,
): Promise<void> {
  const selected = mode === 'better-auth' ? tokens.betterAuth : tokens.v0;
  const inactive = mode === 'better-auth' ? tokens.v0 : tokens.betterAuth;

  await expectStatus('GET', '/health/live', 200);
  await expectStatus('GET', '/api/interests', 200);

  for (const path of [
    '/api/notifications/settings',
    '/api/user/interests',
    '/api/support/tickets',
    '/api/notifications/stream',
  ]) {
    await expectRejected(path);
  }

  await expectStatus('GET', '/api/notifications/settings', 200, {
    token: selected.token,
  });
  await expectStatus('GET', '/api/user/interests', 200, {
    token: selected.token,
  });
  await expectStatus('GET', '/api/support/tickets', 200, {
    token: selected.token,
  });
  await verifySse(selected);

  for (const path of [
    '/api/notifications/settings',
    '/api/user/interests',
    '/api/support/tickets',
  ]) {
    await expectRejected(path, inactive.token);
  }

  await prisma.user.update({
    where: { id: selected.userId },
    data: { isAdmin: true },
  });
  const suffix = `${mode.replace('-', '_')}_${Date.now()}`;
  const created = asObject(
    await json(
      await expectStatus('POST', '/api/interests', 201, {
        token: selected.token,
        body: {
          name: `auth-mode-${suffix}`,
          displayName: `Auth Mode ${mode}`,
        },
      }),
    ),
    'created interest',
  );
  const interestId = requiredString(
    asObject(created.data, 'created interest data'),
    'id',
    'created interest data',
  );
  await expectStatus('DELETE', `/api/interests/${interestId}`, 200, {
    token: selected.token,
  });
}

async function createTokensUnderDefaultMode(
  prisma: PrismaClient,
): Promise<IdentityTokens> {
  const server = startServer(undefined);
  try {
    await waitForServer(server);
    const suffix = `${Date.now()}`;
    const tokens = {
      betterAuth: await createBetterAuthIdentity(suffix),
      v0: await createV0Identity(suffix),
    };
    await verifySelectedMode(prisma, 'better-auth', tokens);
    return tokens;
  } finally {
    await stopServer(server);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error('DATABASE_URL must be configured');
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

await rm(outboxPath, { force: true });
process.env.AUTH_EMAIL_OUTBOX_PATH = outboxPath;
delete process.env.AUTH_MODE;

try {
  await prisma.$connect();
  const tokens = await createTokensUnderDefaultMode(prisma);
  const v0Server = startServer('v0');
  try {
    await waitForServer(v0Server);
    await verifySelectedMode(prisma, 'v0', tokens);
  } finally {
    await stopServer(v0Server);
  }
} finally {
  await prisma.$disconnect();
}

process.stdout.write(
  'AUTH_MODE switch: Better Auth default and explicit v0 protect all migrated controller families and SSE\n',
);
