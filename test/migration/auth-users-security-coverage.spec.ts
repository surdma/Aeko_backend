import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type CapabilityOwner =
  'better-auth-native-cutover' | 'users' | 'profiles' | 'security' | 'media';
type CapabilityId = string;

interface DomainManifest {
  readonly capabilityIds: readonly string[];
}

const ROOT = join(__dirname, '..', '..');
const manifest = JSON.parse(
  readFileSync(
    join(
      ROOT,
      'docs',
      'nestjs-migration',
      'domains',
      'auth-users-security.json',
    ),
    'utf8',
  ),
) as DomainManifest;

const ownerMapPath = join(
  ROOT,
  'docs',
  'nestjs-migration',
  'domains',
  'auth-users-security-owners.json',
);
const ownerMap: Readonly<Record<CapabilityId, readonly [CapabilityOwner]>> =
  existsSync(ownerMapPath)
    ? (JSON.parse(readFileSync(ownerMapPath, 'utf8')) as Readonly<
        Record<CapabilityId, readonly [CapabilityOwner]>
      >)
    : Object.freeze({});

const generatedArtifacts = [
  'src/users/users.module.ts',
  'src/users/users.controller.ts',
  'src/users/users.service.ts',
  'src/profiles/profiles.module.ts',
  'src/profiles/profiles.controller.ts',
  'src/profiles/profiles.service.ts',
  'src/security/security.module.ts',
  'src/security/security.controller.ts',
  'src/security/security.service.ts',
  'src/providers/media/media.module.ts',
  'src/providers/media/cloudinary-media.adapter.ts',
] as const;

describe('auth users security capability ownership', () => {
  it('assigns all 60 capabilities to exactly one feature owner', () => {
    expect(manifest.capabilityIds).toHaveLength(60);
    expect(new Set(Object.keys(ownerMap))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(Object.values(ownerMap).every((owners) => owners.length === 1)).toBe(
      true,
    );
    expect(ownerMap['rest:POST:/api/auth/login:routes/auth.js:881']).toEqual([
      'better-auth-native-cutover',
    ]);
    expect(
      Object.values(ownerMap).reduce<Record<CapabilityOwner, number>>(
        (counts, [owner]) => ({ ...counts, [owner]: counts[owner] + 1 }),
        {
          'better-auth-native-cutover': 0,
          users: 0,
          profiles: 0,
          security: 0,
          media: 0,
        },
      ),
    ).toEqual({
      'better-auth-native-cutover': 28,
      users: 8,
      profiles: 11,
      security: 12,
      media: 1,
    });
  });

  it('has every generated feature boundary imported by AppModule', () => {
    expect(
      generatedArtifacts.filter((path) => !existsSync(join(ROOT, path))),
    ).toEqual([]);

    const appModule = readFileSync(join(ROOT, 'src', 'app.module.ts'), 'utf8');
    for (const moduleName of [
      'UsersModule',
      'ProfilesModule',
      'SecurityModule',
      'MediaModule',
    ]) {
      expect(appModule).toContain(moduleName);
    }
  });
});
