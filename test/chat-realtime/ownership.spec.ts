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
) as Readonly<Record<string, readonly [string]>>;

describe('chat realtime ownership', () => {
  it('assigns every capability exactly once to an approved module', () => {
    expect(manifest.capabilityIds).toHaveLength(102);
    expect(new Set(Object.keys(owners))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(
      Object.values(owners).every(([owner]) =>
        [
          'chat',
          'chat-media',
          'chat-delivery',
          'video-calls',
          'bot',
          'realtime',
        ].includes(owner),
      ),
    ).toBe(true);
  });
});
