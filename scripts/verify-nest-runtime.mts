import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = resolve(root, 'src');
const distRoot = resolve(root, 'dist');
const baseUrl = `http://127.0.0.1:${process.env.PORT ?? '9876'}`;
const legacyAuthBasePath = '/api/v0/auth';

type JsonObject = Readonly<Record<string, unknown>>;

interface HttpOptions {
  readonly body?: unknown;
  readonly token?: string;
  readonly cookie?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

interface HttpResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

interface RuntimeIdentity {
  readonly userId: string;
  readonly token: string;
}

interface CanonicalIdentity {
  readonly userId: string;
  readonly bearerToken: string;
  readonly legacyToken: string;
}

interface SseEvent {
  readonly id: string | null;
  readonly type: string | null;
  readonly data: unknown;
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function string(value: JsonObject, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new TypeError(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

function array(value: JsonObject, key: string, label: string): readonly unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new TypeError(`${label}.${key} must be an array`);
  return field;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function files(rootPath: string, extensions: ReadonlySet<string>): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(rootPath, entry.name);
        if (entry.isDirectory()) return files(path, extensions);
        if (entry.name.endsWith('.d.ts')) return [];
        return extensions.has(extname(entry.name)) ? [path] : [];
      }),
    )
  )
    .flat()
    .sort();
}

function imports(fileName: string, text: string): readonly string[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const result: string[] = [];
  const add = (node: ts.Expression | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) result.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

function sourceTarget(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const emitted = resolve(dirname(importer), specifier);
  if (specifier.endsWith('.js')) return `${emitted.slice(0, -3)}.ts`;
  if (specifier.endsWith('.mjs')) return `${emitted.slice(0, -4)}.mts`;
  if (specifier.endsWith('.cjs')) return `${emitted.slice(0, -4)}.cts`;
  if (specifier.endsWith('.json')) return emitted;
  throw new Error(`${relative(root, importer)} uses extensionless import ${specifier}`);
}

async function verifyModuleGraphs(): Promise<void> {
  const sourceFiles = await files(sourceRoot, new Set(['.ts', '.mts', '.cts']));
  const graph = new Map<string, readonly string[]>();

  for (const file of sourceFiles) {
    const dependencies: string[] = [];
    for (const specifier of imports(file, await readFile(file, 'utf8'))) {
      const target = sourceTarget(file, specifier);
      if (target === null) continue;
      assert.ok(
        await exists(target),
        `${relative(root, file)} imports ${specifier}, but ${relative(root, target)} is missing`,
      );
      if (target.startsWith(sourceRoot)) dependencies.push(target);
    }
    graph.set(file, dependencies);
  }

  const reachable = new Set<string>();
  const pending = [resolve(sourceRoot, 'main.ts')];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || reachable.has(current)) continue;
    reachable.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  const unreachable = sourceFiles
    .filter((file) => !reachable.has(file))
    .map((file) => relative(root, file));
  assert.deepEqual(unreachable, [], `Unreachable src files: ${unreachable.join(', ')}`);

  const emittedFiles = await files(distRoot, new Set(['.js']));
  assert.ok(await exists(resolve(distRoot, 'main.js')), 'dist/main.js is missing');
  for (const file of emittedFiles) {
    for (const specifier of imports(file, await readFile(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      assert.ok(
        await exists(resolve(dirname(file), specifier)),
        `${relative(root, file)} imports missing emitted file ${specifier}`,
      );
    }
  }

  process.stdout.write(
    `module graphs: ${sourceFiles.length} source and ${emittedFiles.length} emitted files resolve\n`,
  );
}

async function call(
  method: string,
  path: string,
  options: HttpOptions = {},
): Promise<HttpResult> {
  const headers = new Headers({ accept: 'application/json', ...options.headers });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`);
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    redirect: 'manual',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: response.headers };
}

async function expect(
  method: string,
  path: string,
  status: number,
  options: HttpOptions = {},
): Promise<HttpResult> {
  const result = await call(method, path, options);
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.body)}`);
  process.stdout.write(`${method} ${path}: HTTP ${status}\n`);
  return result;
}

async function expectStatusIn(
  method: string,
  path: string,
  statuses: readonly number[],
  options: HttpOptions = {},
): Promise<HttpResult> {
  const result = await call(method, path, options);
  assert.ok(
    statuses.includes(result.status),
    `${method} ${path}: expected ${statuses.join('/')}, got ${result.status}: ${JSON.stringify(result.body)}`,
  );
  process.stdout.write(`${method} ${path}: HTTP ${result.status}\n`);
  return result;
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

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
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

async function verifyHealthAndWaitlist(suffix: string): Promise<void> {
  assert.equal(object((await expect('GET', '/health/live', 200)).body, 'liveness').status, 'ok');
  assert.equal(object((await expect('GET', '/health/ready', 200)).body, 'readiness').status, 'ready');

  const waitlist = { name: 'Runtime User', email: `waitlist-${suffix}@example.com` };
  await expect('POST', '/api/waitlist', 400, { body: { email: waitlist.email } });
  assert.equal(
    object((await expect('POST', '/api/waitlist', 201, { body: waitlist })).body, 'waitlist').success,
    true,
  );
  await expect('POST', '/api/waitlist', 409, { body: waitlist });
}

async function verifyLegacyAuthentication(
  suffix: string,
  jwtSecret: string,
): Promise<RuntimeIdentity> {
  await expect('GET', `${legacyAuthBasePath}/google`, 503);
  await expect('GET', `${legacyAuthBasePath}/google/callback`, 503);
  await expect('POST', `${legacyAuthBasePath}/google/mobile`, 503, {
    body: { idToken: 'unused-without-provider-configuration' },
  });

  const email = `runtime-v0-${suffix}@example.com`;
  const oldPassword = 'runtime-password';
  const newPassword = 'runtime-password-updated';
  const signup = object(
    (
      await expect('POST', `${legacyAuthBasePath}/signup`, 201, {
        body: { name: 'Runtime V0 User', username: `runtime_v0_${suffix}`, email, password: oldPassword },
      })
    ).body,
    'v0 signup',
  );
  assert.equal(signup.emailSent, false);
  const userId = string(signup, 'userId', 'v0 signup');

  const verified = object(
    (
      await expect('POST', `${legacyAuthBasePath}/verify-email`, 200, {
        body: { userId, verificationCode: string(signup, 'verificationCode', 'v0 signup') },
      })
    ).body,
    'v0 verify email',
  );
  await expect('POST', `${legacyAuthBasePath}/resend-verification`, 400, { body: { userId } });

  const login = object(
    (
      await expect('POST', `${legacyAuthBasePath}/login`, 200, {
        body: { email, password: oldPassword },
      })
    ).body,
    'v0 login',
  );
  const loginToken = string(login, 'token', 'v0 login');
  assert.equal(
    object(
      (await expect('GET', `${legacyAuthBasePath}/me`, 200, { token: loginToken })).body,
      'v0 me',
    ).success,
    true,
  );
  await expect('GET', `${legacyAuthBasePath}/profile-completion`, 200, {
    token: string(verified, 'token', 'v0 verify email'),
  });
  await expect('POST', `${legacyAuthBasePath}/forgot-password`, 200, { body: { email } });

  const resetToken = await new JwtService({ secret: jwtSecret }).signAsync(
    { userId },
    { expiresIn: 3_600 },
  );
  await expect('POST', `${legacyAuthBasePath}/reset-password`, 200, {
    body: { token: resetToken, newPassword },
  });
  const token = string(
    object(
      (
        await expect('POST', `${legacyAuthBasePath}/login`, 200, {
          body: { email, password: newPassword },
        })
      ).body,
      'v0 login after reset',
    ),
    'token',
    'v0 login after reset',
  );
  assert.match(
    (await expect('POST', `${legacyAuthBasePath}/logout`, 200)).headers.get('set-cookie') ?? '',
    /token=/u,
  );
  return { userId, token };
}

async function verifyBetterAuth(
  prisma: PrismaClient,
  suffix: string,
  jwtSecret: string,
): Promise<CanonicalIdentity> {
  await expect('GET', '/api/auth/ok', 200);
  const email = `runtime-v1-${suffix}@example.com`;
  const username = `runtime_v1_${suffix}`.slice(0, 30);
  const password = 'runtime-password-v1';

  const signup = await expect('POST', '/api/auth/sign-up/email', 200, {
    body: {
      name: 'Runtime V1 User',
      email,
      password,
      username,
      displayUsername: 'Runtime V1 User',
    },
  });
  const signupBody = object(signup.body, 'Better Auth signup');
  const signupUser = object(signupBody.user, 'Better Auth signup user');
  const userId = string(signupUser, 'id', 'Better Auth signup user');

  const [authUser, account, profile, projection, migration] = await Promise.all([
    prisma.authUser.findUnique({ where: { id: userId } }),
    prisma.authAccount.findFirst({ where: { userId, providerId: 'credential' } }),
    prisma.profile.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.authMigrationLink.findUnique({ where: { authUserId: userId } }),
  ]);
  assert.equal(authUser?.email, email);
  assert.equal(authUser?.username, username);
  assert.equal(account?.accountId, userId);
  assert.ok(typeof account?.password === 'string' && account.password.length > 20);
  assert.equal(profile?.userId, userId);
  assert.equal(projection?.email, email);
  assert.equal(migration?.legacyUserId, userId);
  assert.equal(migration?.status, 'MIGRATED');

  await expect('POST', '/api/auth/sign-in/email', 403, {
    body: { email, password },
  });
  const verification = await prisma.authVerification.findFirst({
    where: { identifier: { contains: email } },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(verification !== null, 'Better Auth did not persist an email verification token');
  await expectStatusIn(
    'GET',
    `/api/auth/verify-email?token=${encodeURIComponent(verification.value)}&callbackURL=%2F`,
    [200, 302],
  );
  assert.equal(
    (await prisma.authUser.findUnique({ where: { id: userId } }))?.emailVerified,
    true,
  );

  const emailLogin = await expect('POST', '/api/auth/sign-in/email', 200, {
    body: { email, password },
  });
  const bearerToken = emailLogin.headers.get('set-auth-token');
  assert.ok(bearerToken !== null && bearerToken.length > 20, 'Bearer token header is missing');

  const session = object(
    (await expect('GET', '/api/auth/get-session', 200, { token: bearerToken })).body,
    'Better Auth session',
  );
  assert.equal(string(object(session.user, 'session user'), 'id', 'session user'), userId);

  const usernameLogin = await expect('POST', '/api/auth/sign-in/username', 200, {
    body: { username, password },
  });
  assert.ok((usernameLogin.headers.get('set-auth-token') ?? '').length > 20);

  const passkeys = await expect('GET', '/api/auth/passkey/list-user-passkeys', 200, {
    token: bearerToken,
  });
  assert.deepEqual(passkeys.body, []);
  await expectStatusIn('POST', '/api/auth/sign-in/social', [400, 404], {
    body: { provider: 'google', callbackURL: '/' },
  });

  const legacyToken = await new JwtService({ secret: jwtSecret }).signAsync(
    { userId },
    { expiresIn: 3_600 },
  );
  return { userId, bearerToken, legacyToken };
}

async function verifyInterests(token: string, suffix: string): Promise<string> {
  await expect('GET', '/api/interests', 200);
  const created = object(
    (
      await expect('POST', '/api/interests', 201, {
        token,
        body: { name: `runtime-${suffix}`, displayName: 'Runtime Interest' },
      })
    ).body,
    'create interest',
  );
  const interestId = string(object(created.data, 'interest data'), 'id', 'interest data');
  await expect('POST', '/api/user/interests', 201, { token, body: { interestIds: [interestId] } });
  assert.equal(
    array(object((await expect('GET', '/api/user/interests', 200, { token })).body, 'user interests'), 'data', 'user interests').length,
    1,
  );
  await expect('PUT', `/api/interests/${interestId}`, 200, {
    token,
    body: { displayName: 'Runtime Interest Updated' },
  });
  await expect('DELETE', `/api/user/interests/${interestId}`, 200, { token });
  return interestId;
}

async function verifySupport(token: string): Promise<void> {
  const created = object(
    (
      await expect('POST', '/api/support/tickets', 201, {
        token,
        body: {
          subject: 'Runtime support check',
          description: 'Verify compiled Nest HTTP and persistence behavior',
          category: 'technical',
        },
      })
    ).body,
    'create ticket',
  );
  const ticketId = string(object(created.ticket, 'ticket'), 'id', 'ticket');
  assert.equal(
    array(object((await expect('GET', '/api/support/tickets', 200, { token })).body, 'tickets'), 'tickets', 'tickets').length,
    1,
  );
  await expect('GET', `/api/support/tickets/${ticketId}`, 200, { token });
  await expect('POST', `/api/support/tickets/${ticketId}/messages`, 201, {
    token,
    body: { message: 'Runtime reply', attachments: [] },
  });
  await expect('PATCH', `/api/support/tickets/${ticketId}/status`, 200, {
    token,
    body: { status: 'resolved' },
  });
  await expect('GET', '/api/support/admin/tickets?page=1&limit=20', 200, { token });
  await expect('PATCH', `/api/support/admin/tickets/${ticketId}/priority`, 200, {
    token,
    body: { priority: 'high' },
  });
}

async function verifyLegacyNotifications(
  prisma: PrismaClient,
  identity: RuntimeIdentity,
  suffix: string,
): Promise<void> {
  await expect('GET', '/api/notifications/settings', 200, { token: identity.token });
  const settings = { global: { pauseAll: false, quietMode: true }, interactions: { likes: true } };
  assert.deepEqual(
    (await expect('PUT', '/api/notifications/settings', 200, { token: identity.token, body: settings })).body,
    settings,
  );
  await expect('PUT', '/api/notifications/push-token', 200, {
    token: identity.token,
    body: { pushToken: `push-${suffix}` },
  });

  const notification = await prisma.notification.create({
    data: {
      recipientId: identity.userId,
      senderId: identity.userId,
      type: 'SYSTEM',
      title: 'Runtime notification',
      message: 'Runtime verification',
    },
  });
  assert.equal(
    object((await expect('GET', '/api/notifications/unread-count', 200, { token: identity.token })).body, 'unread').count,
    1,
  );
  assert.equal(
    array(
      object(
        (await expect('GET', '/api/notifications?page=1&limit=20', 200, { token: identity.token })).body,
        'notifications',
      ),
      'notifications',
      'notifications',
    ).length,
    1,
  );
  assert.equal(
    object(
      (await expect('PUT', `/api/notifications/${notification.id}/read`, 200, { token: identity.token })).body,
      'mark read',
    ).read,
    true,
  );
  await expect('PUT', '/api/notifications/read-all', 200, { token: identity.token });
  await expect('DELETE', `/api/notifications/${notification.id}`, 200, { token: identity.token });
}

function parseSseFrame(frame: string): SseEvent {
  let id: string | null = null;
  let type: string | null = null;
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  const text = dataLines.join('\n');
  let data: unknown = text;
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }
  return { id, type, data };
}

function createSseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';
  return async (): Promise<SseEvent> => {
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        return parseSseFrame(frame);
      }
      const next = await reader.read();
      if (next.done) throw new Error('Notification SSE stream closed unexpectedly');
      buffer += decoder.decode(next.value, { stream: true }).replaceAll('\r\n', '\n');
    }
  };
}

async function verifyNotificationSse(
  prisma: PrismaClient,
  identity: CanonicalIdentity,
): Promise<void> {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}/api/notifications/stream`, {
    headers: { Authorization: `Bearer ${identity.bearerToken}` },
    signal: abort.signal,
  });
  assert.equal(response.status, 200, `SSE returned HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/u);
  assert.ok(response.body !== null, 'SSE response has no body');
  const reader = response.body.getReader();
  const nextEvent = createSseReader(reader);

  try {
    const connected = await nextEvent();
    assert.equal(connected.type, 'connected');
    assert.equal(object(connected.data, 'connected event').userId, identity.userId);

    const notification = await prisma.notification.create({
      data: {
        recipientId: identity.userId,
        senderId: identity.userId,
        type: 'SYSTEM',
        title: 'Canonical runtime notification',
        message: 'Verify Better Auth SSE delivery',
      },
    });
    await expect('PUT', `/api/notifications/${notification.id}/read`, 200, {
      token: identity.legacyToken,
    });

    let readEvent: SseEvent | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const event = await nextEvent();
      if (event.type === 'notification.read') {
        readEvent = event;
        break;
      }
    }
    assert.ok(readEvent !== null, 'SSE did not deliver notification.read');
    assert.equal(
      object(readEvent.data, 'notification.read event').notificationId,
      notification.id,
    );
  } finally {
    abort.abort();
    await reader.cancel().catch(() => undefined);
  }
  process.stdout.write('GET /api/notifications/stream: authenticated SSE event delivered\n');
}

async function verifyRuntime(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  if (databaseUrl === undefined || jwtSecret === undefined) {
    throw new Error('DATABASE_URL and JWT_SECRET must be loaded from .env');
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: root,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(`[nest] ${chunk.toString()}`));
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[nest] ${chunk.toString()}`));

  try {
    await prisma.$connect();
    await waitForServer(child);
    const suffix = `${Date.now()}`;
    await verifyHealthAndWaitlist(suffix);
    const legacyIdentity = await verifyLegacyAuthentication(suffix, jwtSecret);
    const canonicalIdentity = await verifyBetterAuth(prisma, suffix, jwtSecret);
    await prisma.user.update({ where: { id: legacyIdentity.userId }, data: { isAdmin: true } });
    const interestId = await verifyInterests(legacyIdentity.token, suffix);
    await verifySupport(legacyIdentity.token);
    await verifyLegacyNotifications(prisma, legacyIdentity, suffix);
    await verifyNotificationSse(prisma, canonicalIdentity);
    await expect('DELETE', `/api/interests/${interestId}`, 200, { token: legacyIdentity.token });
    await expect('POST', '/api/auth/sign-out', 200, { token: canonicalIdentity.bearerToken });
    process.stdout.write(
      'compiled Nest runtime, Better Auth v1, v0 compatibility and notification SSE passed\n',
    );
  } finally {
    await stop(child);
    await prisma.$disconnect();
  }
}

await verifyModuleGraphs();
await verifyRuntime();
