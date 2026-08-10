import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type DomainOwner = 'debates' | 'challenges' | 'spaces';

type OwnerMap = Readonly<Record<string, readonly [DomainOwner]>>;

interface Manifest {
  readonly capabilityIds: readonly string[];
}

const root = join(__dirname, '..', '..');

const manifest = JSON.parse(
  readFileSync(
    join(
      root,
      'docs',
      'nestjs-migration',
      'domains',
      'debates-challenges-spaces.json',
    ),
    'utf8',
  ),
) as Manifest;

const ownersPath = join(
  root,
  'docs',
  'nestjs-migration',
  'domains',
  'debates-challenges-spaces-owners.json',
);

const owners: OwnerMap = existsSync(ownersPath)
  ? (JSON.parse(readFileSync(ownersPath, 'utf8')) as OwnerMap)
  : Object.freeze({});

const MODULE_FILES = [
  'src/debates/debates.module.ts',
  'src/debates/debates.controller.ts',
  'src/debates/debates.service.ts',
  'src/challenges/challenges.module.ts',
  'src/challenges/challenges.controller.ts',
  'src/challenges/challenges.service.ts',
  'src/spaces/spaces.module.ts',
  'src/spaces/spaces.controller.ts',
  'src/spaces/spaces.service.ts',
  'src/providers/debate-scoring/debate-scoring.port.ts',
];

const APP_MODULES = ['DebatesModule', 'ChallengesModule', 'SpacesModule'];

describe('debates challenges spaces capability ownership', () => {
  it('assigns all 16 capabilities to exactly one feature owner', () => {
    expect(manifest.capabilityIds).toHaveLength(16);
    expect(new Set(Object.keys(owners))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(Object.values(owners).every((value) => value.length === 1)).toBe(
      true,
    );
    expect(
      Object.values(owners).reduce<Record<DomainOwner, number>>(
        (counts, [owner]) => ({ ...counts, [owner]: counts[owner] + 1 }),
        { debates: 0, challenges: 0, spaces: 0 },
      ),
    ).toEqual({ debates: 6, challenges: 6, spaces: 4 });
  });

  it('owns every capability by the feature its path or model belongs to', () => {
    const prefixes: Readonly<Record<DomainOwner, string>> = {
      debates: '/api/debates',
      challenges: '/api/challenges',
      spaces: '/api/spaces',
    };
    const models: Readonly<Record<string, DomainOwner>> = {
      'model:model:Debate': 'debates',
      'model:model:Challenge': 'challenges',
      'model:model:Space': 'spaces',
    };

    const mismatched = Object.entries(owners).filter(([id, [owner]]) => {
      if (id.startsWith('model:')) return models[id] !== owner;
      const path = id.split(':')[2] ?? '';
      const prefix = prefixes[owner];
      return path !== prefix && !path.startsWith(`${prefix}/`);
    });
    expect(mismatched).toEqual([]);
  });

  it('has every CLI-generated module imported by AppModule', () => {
    expect(
      MODULE_FILES.filter((path) => !existsSync(join(root, path))),
    ).toEqual([]);
    const appModule = readFileSync(join(root, 'src', 'app.module.ts'), 'utf8');
    for (const moduleName of APP_MODULES) {
      expect(appModule).toContain(moduleName);
    }
  });
});
