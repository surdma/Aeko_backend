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

type JsonObject = Readonly<Record<string, unknown>>;

interface HttpResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

interface RuntimeIdentity {
  readonly userId: string;
  readonly token: string;
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
  options: Readonly<{ body?: unknown; token?: string }> = {},
): Promise<HttpResult> {
  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`);
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
  options: Readonly<{ body?: unknown; token?: string }> = {},
): Promise<HttpResult> {
  const result = await call(method, path, options);
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.body)}`);
  process.stdout.write(`${method} ${path}: HTTP ${status}\n`);
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
  assert.equal(object((await expect('POST', '/api/waitlist', 201, { body: waitlist })).body, 'waitlist').success, true);
  await expect('POST', '/api/waitlist', 409, { body: waitlist });
}

async function verifyAuthentication(suffix: string, jwtSecret: string): Promise<RuntimeIdentity> {
  await expect('GET', '/api/auth/google', 503);
  await expect('GET', '/api/auth/google/callback', 503);
  await expect('POST', '/api/auth/google/mobile', 503, {
    body: { idToken: 'unused-without-provider-configuration' },
  });

  const email = `runtime-${suffix}@example.com`;
  const oldPassword = 'runtime-password';
  const newPassword = 'runtime-password-updated';
  const signup = object(
    (
      await expect('POST', '/api/auth/signup', 201, {
        body: { name: 'Runtime User', username: `runtime_${suffix}`, email, password: oldPassword },
      })
    ).body,
    'signup',
  );
  assert.equal(signup.emailSent, false);
  const userId = string(signup, 'userId', 'signup');

  const verified = object(
    (
      await expect('POST', '/api/auth/verify-email', 200, {
        body: { userId, verificationCode: string(signup, 'verificationCode', 'signup') },
      })
    ).body,
    'verify email',
  );
  await expect('POST', '/api/auth/resend-verification', 400, { body: { userId } });

  const login = object(
    (await expect('POST', '/api/auth/login', 200, { body: { email, password: oldPassword } })).body,
    'login',
  );
  const loginToken = string(login, 'token', 'login');
  assert.equal(object((await expect('GET', '/api/auth/me', 200, { token: loginToken })).body, 'me').success, true);
  await expect('GET', '/api/auth/profile-completion', 200, {
    token: string(verified, 'token', 'verify email'),
  });
  await expect('POST', '/api/auth/forgot-password', 200, { body: { email } });

  const resetToken = await new JwtService({ secret: jwtSecret }).signAsync(
    { userId },
    { expiresIn: 3_600 },
  );
  await expect('POST', '/api/auth/reset-password', 200, {
    body: { token: resetToken, newPassword },
  });
  const token = string(
    object(
      (await expect('POST', '/api/auth/login', 200, { body: { email, password: newPassword } })).body,
      'login after reset',
    ),
    'token',
    'login after reset',
  );
  assert.match((await expect('POST', '/api/auth/logout', 200)).headers.get('set-cookie') ?? '', /token=/u);
  return { userId, token };
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

async function verifyNotifications(
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
    const identity = await verifyAuthentication(suffix, jwtSecret);
    await prisma.user.update({ where: { id: identity.userId }, data: { isAdmin: true } });
    const interestId = await verifyInterests(identity.token, suffix);
    await verifySupport(identity.token);
    await verifyNotifications(prisma, identity, suffix);
    await expect('DELETE', `/api/interests/${interestId}`, 200, { token: identity.token });
    process.stdout.write('compiled Nest runtime and migrated HTTP/database scenarios passed\n');
  } finally {
    await stop(child);
    await prisma.$disconnect();
  }
}

await verifyModuleGraphs();
await verifyRuntime();
