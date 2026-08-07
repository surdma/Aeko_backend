import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { migrateV0Users } from './migration/migrate-v0-auth-users.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const baseUrl = `http://127.0.0.1:${process.env.PORT ?? '9876'}`;
const migratedPassword = 'runtime-password-updated';

type JsonObject = Readonly<Record<string, unknown>>;

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

async function waitForServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Nest exited with code ${child.exitCode}`);
    }
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

async function signInMigratedUser(
  email: string,
  expectedUserId: string,
): Promise<void> {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  child.stdout.on('data', (chunk: Buffer) => {
    process.stdout.write(`[nest:migration] ${chunk.toString()}`);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[nest:migration] ${chunk.toString()}`);
  });

  try {
    await waitForServer(child);
    const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password: migratedPassword }),
    });
    const signInBody = (await signIn.json()) as unknown;
    assert.equal(
      signIn.status,
      200,
      `Migrated Better Auth sign-in returned ${signIn.status}: ${JSON.stringify(signInBody)}`,
    );
    const bearerToken = signIn.headers.get('set-auth-token');
    assert.ok(
      bearerToken !== null && bearerToken.length > 20,
      'Migrated sign-in did not return a signed bearer token',
    );

    const sessionResponse = await fetch(`${baseUrl}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${bearerToken}` },
    });
    const sessionBody = object(
      (await sessionResponse.json()) as unknown,
      'migrated session',
    );
    assert.equal(sessionResponse.status, 200);
    assert.equal(
      string(object(sessionBody.user, 'migrated session user'), 'id', 'migrated session user'),
      expectedUserId,
    );

    const signOut = await fetch(`${baseUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearerToken}` },
    });
    assert.equal(signOut.status, 200);
    process.stdout.write(
      'v0 identity migration: preserved ID and bcrypt password authenticated through Better Auth\n',
    );
  } finally {
    await stopServer(child);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error('DATABASE_URL must be loaded from .env');

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  await prisma.$connect();
  const legacy = await prisma.user.findFirst({
    where: { email: { startsWith: 'runtime-v0-' } },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(legacy !== null, 'The primary runtime verifier did not create a v0 user');
  assert.equal(
    await prisma.authUser.findUnique({ where: { id: legacy.id } }),
    null,
    'The v0 user was canonical before the importer ran',
  );

  const dryRun = await migrateV0Users(prisma, 'dry-run');
  assert.equal(dryRun.failed, 0);
  assert.equal(dryRun.conflicts, 0);
  assert.ok(dryRun.migrated >= 1, 'Dry-run did not identify the v0 user');

  const applied = await migrateV0Users(prisma, 'apply');
  assert.equal(applied.failed, 0);
  assert.equal(applied.conflicts, 0);
  assert.ok(applied.migrated >= 1, 'Apply did not migrate the v0 user');

  const [canonical, credential, profile, link] = await Promise.all([
    prisma.authUser.findUnique({ where: { id: legacy.id } }),
    prisma.authAccount.findFirst({
      where: {
        userId: legacy.id,
        accountId: legacy.id,
        providerId: 'credential',
      },
    }),
    prisma.profile.findUnique({ where: { userId: legacy.id } }),
    prisma.authMigrationLink.findUnique({ where: { legacyUserId: legacy.id } }),
  ]);
  assert.equal(canonical?.id, legacy.id);
  assert.equal(canonical?.email, legacy.email);
  assert.equal(canonical?.emailVerified, true);
  assert.equal(credential?.password, legacy.password);
  assert.equal(profile?.userId, legacy.id);
  assert.equal(link?.authUserId, legacy.id);
  assert.equal(link?.status, 'MIGRATED');

  const rerun = await migrateV0Users(prisma, 'apply');
  assert.equal(rerun.failed, 0);
  assert.equal(rerun.conflicts, 0);
  assert.ok(rerun.alreadyMigrated >= 2, 'Importer rerun did not skip migrated identities');
  assert.equal(
    (await prisma.authUser.findUnique({ where: { id: legacy.id } }))?.emailVerified,
    true,
    'Importer rerun regressed canonical verification state',
  );

  await prisma.$disconnect();
  await signInMigratedUser(legacy.email, legacy.id);
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
