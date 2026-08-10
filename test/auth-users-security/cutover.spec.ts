import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ProfilesController } from '../../src/profiles/profiles.controller';
import { SecurityController } from '../../src/security/security.controller';
import { UsersController } from '../../src/users/users.controller';

interface DomainManifest {
  readonly capabilityIds: readonly string[];
  readonly migration?: {
    readonly status?: string;
    readonly assigned?: number;
    readonly missing?: number;
    readonly duplicate?: number;
    readonly unresolved?: number;
  };
}

interface Correction {
  readonly id: string;
  readonly capabilityIds: readonly string[];
}

type OwnerMap = Readonly<Record<string, readonly [string]>>;

const root = join(__dirname, '..', '..');
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
const manifest = readJson(
  'docs/nestjs-migration/domains/auth-users-security.json',
) as DomainManifest;
const owners = readJson(
  'docs/nestjs-migration/domains/auth-users-security-owners.json',
) as OwnerMap;
const corrections = readJson(
  'docs/nestjs-migration/corrections.json',
) as readonly Correction[];

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });

const controllerRoutes = (controller: object): readonly string[] => {
  const rootPath: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  const prefix = typeof rootPath === 'string' ? `/${rootPath}` : '';
  const prototype: unknown = Reflect.get(controller, 'prototype');
  if (typeof prototype !== 'object' || prototype === null) return [];
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler: unknown = Reflect.get(prototype, name);
      if (typeof handler !== 'function') return [];
      const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (typeof method !== 'number' || typeof path !== 'string') return [];
      const methodName = RequestMethod[method];
      if (typeof methodName !== 'string') return [];
      const suffix = path === '/' ? '' : `/${path}`;
      return [`${methodName} ${prefix}${suffix}`];
    });
};

const expectedRoutes = [
  'DELETE /api/security/block/:userId',
  'DELETE /api/users/:id',
  'GET /api/profile',
  'GET /api/profile/activity',
  'GET /api/profile/eligibility',
  'GET /api/profile/followers',
  'GET /api/profile/followers/search',
  'GET /api/profile/following',
  'GET /api/security/block-status/:userId',
  'GET /api/security/blocked',
  'GET /api/security/events',
  'GET /api/security/follow-requests',
  'GET /api/security/privacy',
  'GET /api/security/stats',
  'GET /api/users',
  'GET /api/users/:id',
  'GET /api/users/:id/followers',
  'GET /api/users/:id/following',
  'POST /api/profile/verify',
  'POST /api/security/block/:userId',
  'POST /api/security/follow-request/:userId',
  'PUT /api/profile/follow/:id',
  'PUT /api/profile/unfollow/:id',
  'PUT /api/profile/update',
  'PUT /api/security/follow-request/:requesterId',
  'PUT /api/security/privacy',
  'PUT /api/users/cover-picture',
  'PUT /api/users/profile-picture',
].sort();

describe('auth users security cutover', () => {
  it('closes the native Better Auth correction over every native-owned capability', () => {
    const nativeOwned = Object.entries(owners)
      .filter(([, [owner]]) => owner === 'better-auth-native-cutover')
      .map(([id]) => id)
      .sort();
    const correction = corrections.find(
      (candidate) => candidate.id === 'correction:native-better-auth-cutover',
    );
    expect(correction?.capabilityIds.slice().sort()).toEqual(nativeOwned);
    expect(nativeOwned).toHaveLength(28);
  });

  it('declares exact 60-of-60 domain closure without hiding programme-final gates', () => {
    expect(manifest.capabilityIds).toHaveLength(60);
    expect(manifest.migration).toEqual({
      status: 'implemented',
      assigned: 60,
      missing: 0,
      duplicate: 0,
      unresolved: 0,
    });
  });

  it('exposes the exact non-auth Nest route set', () => {
    const actual = [
      ...controllerRoutes(UsersController),
      ...controllerRoutes(ProfilesController),
      ...controllerRoutes(SecurityController),
    ].sort();
    expect(actual).toEqual(expectedRoutes);
  });

  it('keeps native Better Auth as the sole /api/auth owner', () => {
    const files = sourceFiles(join(root, 'src'));
    const compatibilityControllers = files.filter((path) =>
      /auth.*controller\.ts$/i.test(relative(root, path)),
    );
    expect(compatibilityControllers).toEqual([]);
    const main = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
    expect(main).toContain("pathname === '/api/auth'");
    expect(main).toContain("pathname.startsWith('/api/auth/')");
    expect(main.match(/toNodeHandler\(auth\)/g) ?? []).toHaveLength(1);
  });

  it('contains no legacy auth stack, second runtime client, or unsafe domain syntax', () => {
    // `src/generated` is Prisma CLI output, not hand-written runtime code.
    const files = sourceFiles(join(root, 'src')).filter(
      (path) =>
        !relative(root, path)
          .replaceAll('\\', '/')
          .startsWith('src/generated/'),
    );
    const runtimeFiles = files.map((path) => ({
      path,
      source: readFileSync(path, 'utf8'),
    }));
    const runtime = runtimeFiles.map(({ source }) => source).join('\n');
    expect(runtime).not.toMatch(
      /from ['"](?:bcrypt|jsonwebtoken|passport|jose)['"]/,
    );
    expect(
      runtimeFiles
        .filter(({ source }) =>
          /new\s+(?:PrismaClient|PrismaPg)\s*\(/.test(source),
        )
        .map(({ path }) => relative(root, path).replaceAll('\\', '/')),
    ).toEqual(['src/database/database.module.ts']);
    const domain = files
      .filter((path) =>
        /[\\/](?:auth|users|profiles|security|providers[\\/]media)[\\/]/.test(
          path,
        ),
      )
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(domain).not.toMatch(
      /:\s*any\b|<any>|\bas\s+any\b|as\s+unknown\s+as/,
    );
    expect(domain).not.toMatch(/\w!\.|\w!\[/);
    expect(domain).not.toMatch(
      /console\.(?:log|error).*?(?:password|token|secret)/i,
    );
  });

  it('has the cutover documentation and official Better Auth provenance', () => {
    const documentation = readFileSync(
      join(root, 'docs', 'nestjs-migration', 'auth-compatibility.md'),
      'utf8',
    );
    for (const contract of [
      'sign-up/email',
      'sign-in/email',
      'get-session',
      'request-password-reset',
      'reset-password',
      'sign-in/social',
      'change-password',
      'change-email',
      'delete-user',
      'two-factor',
    ]) {
      expect(documentation).toContain(contract);
    }
    expect(
      existsSync(
        join(root, 'docs', 'nestjs-migration', 'better-auth.generated.prisma'),
      ),
    ).toBe(true);
  });
});
