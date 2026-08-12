import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const readJson = (...path: readonly string[]): unknown =>
  JSON.parse(readFileSync(join(ROOT, ...path), 'utf8')) as unknown;

const manifest = readJson(
  'docs/nestjs-migration/domains/chat-realtime.json',
) as {
  capabilityIds: readonly string[];
};
const owners = readJson(
  'docs/nestjs-migration/domains/chat-realtime-owners.json',
) as Readonly<Record<string, readonly string[]>>;

const APPROVED_OWNERS = new Set([
  'chat',
  'chat-media',
  'chat-delivery',
  'video-calls',
  'bot',
  'realtime',
]);

describe('chat realtime ownership', () => {
  it('assigns every capability exactly once to an approved module', () => {
    expect(manifest.capabilityIds).toHaveLength(102);
    expect(new Set(manifest.capabilityIds).size).toBe(102);
    expect(new Set(Object.keys(owners))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(
      Object.values(owners).every(
        (ownerTuple) =>
          Array.isArray(ownerTuple) &&
          ownerTuple.length === 1 &&
          APPROVED_OWNERS.has(ownerTuple[0]),
      ),
    ).toBe(true);
  });
});
