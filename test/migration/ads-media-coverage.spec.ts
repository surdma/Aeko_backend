import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type AdsMediaOwner = 'ads' | 'media-processing';
type OwnerMap = Readonly<Record<string, readonly [AdsMediaOwner]>>;

interface Manifest {
  readonly capabilityIds: readonly string[];
}

const root = join(__dirname, '..', '..');
const manifest = JSON.parse(
  readFileSync(
    join(root, 'docs', 'nestjs-migration', 'domains', 'ads-media.json'),
    'utf8',
  ),
) as Manifest;
const ownersPath = join(
  root,
  'docs',
  'nestjs-migration',
  'domains',
  'ads-media-owners.json',
);
const owners: OwnerMap = existsSync(ownersPath)
  ? (JSON.parse(readFileSync(ownersPath, 'utf8')) as OwnerMap)
  : Object.freeze({});

describe('ads media capability ownership', () => {
  it('assigns all 16 capabilities to exactly one feature owner', () => {
    expect(manifest.capabilityIds).toHaveLength(16);
    expect(new Set(Object.keys(owners))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(Object.values(owners).every((value) => value.length === 1)).toBe(
      true,
    );
    expect(
      Object.values(owners).reduce<Record<AdsMediaOwner, number>>(
        (counts, [owner]) => ({ ...counts, [owner]: counts[owner] + 1 }),
        { ads: 0, 'media-processing': 0 },
      ),
    ).toEqual({ ads: 14, 'media-processing': 2 });
  });

  it('has both CLI-generated modules imported by AppModule', () => {
    expect(
      [
        'src/ads/ads.module.ts',
        'src/ads/ads.controller.ts',
        'src/ads/ads.service.ts',
        'src/providers/media-processing/media-processing.module.ts',
        'src/providers/media-processing/media-processing.controller.ts',
        'src/providers/media-processing/media-processing.service.ts',
      ].filter((path) => !existsSync(join(root, path))),
    ).toEqual([]);
    const appModule = readFileSync(join(root, 'src', 'app.module.ts'), 'utf8');
    expect(appModule).toContain('AdsModule');
    expect(appModule).toContain('MediaProcessingModule');
  });
});
