import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Manifest {
  readonly capabilityIds: readonly string[];
  readonly cutoverUnit: readonly string[];
  readonly migration: {
    readonly status: string;
    readonly assigned: number;
    readonly missing: number;
    readonly duplicate: number;
    readonly unresolved: number;
  };
}

const root = join(__dirname, '..', '..');
const readJson = (...path: readonly string[]): unknown =>
  JSON.parse(readFileSync(join(root, ...path), 'utf8')) as unknown;

const manifest = readJson(
  'docs',
  'nestjs-migration',
  'domains',
  'chat-realtime.json',
) as Manifest;
const owners = readJson(
  'docs',
  'nestjs-migration',
  'domains',
  'chat-realtime-owners.json',
) as Readonly<Record<string, readonly string[]>>;

describe('chat realtime migration coverage', () => {
  it('closes the complete 102-capability cutover unit exactly once', () => {
    expect(manifest.migration).toEqual({
      status: 'implemented',
      assigned: 102,
      missing: 0,
      duplicate: 0,
      unresolved: 0,
    });
    expect(manifest.capabilityIds).toHaveLength(102);
    expect(new Set(manifest.cutoverUnit)).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(new Set(Object.keys(owners))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(Object.values(owners).every((owner) => owner.length === 1)).toBe(
      true,
    );
  });

  it('keeps the active migration test allowlist explicit', () => {
    const config = readJson('test', 'migration', 'jest.config.json') as {
      readonly testRegex: string;
    };
    expect(config.testRegex).toContain('chat-realtime-coverage');
  });
});
