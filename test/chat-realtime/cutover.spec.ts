import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChatGateway } from '../../src/chat/chat.gateway';
import { VideoCallsGateway } from '../../src/chat/signalling/video-calls.gateway';
import { restContracts } from '../../src/chat/chat.contract';
import {
  inboundEventSchemas,
  outboundEventViews,
} from '../../src/chat/chat-events.contract';

const ROOT = join(__dirname, '..', '..');

interface Migration {
  readonly status: string;
  readonly assigned: number;
  readonly missing: number;
  readonly duplicate: number;
  readonly unresolved: number;
}

interface Manifest {
  readonly capabilityIds: readonly string[];
  readonly corrections: readonly string[];
  readonly cutoverUnit: readonly string[];
  readonly migration?: Migration;
}

interface Correction {
  readonly id: string;
  readonly status: string;
}

const readJson = (...path: readonly string[]): unknown =>
  JSON.parse(readFileSync(join(ROOT, ...path), 'utf8')) as unknown;
const readSource = (...path: readonly string[]): string =>
  readFileSync(join(ROOT, ...path), 'utf8');
const readCode = (...path: readonly string[]): string =>
  readSource(...path)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');

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
const corrections = readJson(
  'docs',
  'nestjs-migration',
  'corrections.json',
) as readonly Correction[];

const expectedRoutes = manifest.capabilityIds
  .filter((id) => id.startsWith('rest:'))
  .map((id) => {
    const match = /^rest:([A-Z]+):(.+):routes\//u.exec(id);
    if (!match) throw new Error(`Invalid REST capability id: ${id}`);
    return `${match[1]} ${match[2]}`;
  });

const routeSet = (): string[] =>
  Object.keys(restContracts).map((id) => {
    const match = /^rest:([A-Z]+):(.+):routes\//u.exec(id);
    if (!match) throw new Error(`Invalid REST contract id: ${id}`);
    return `${match[1]} ${match[2]}`;
  });

describe('chat realtime atomic cutover', () => {
  it('closes every capability with one Nest owner', () => {
    expect(manifest.capabilityIds).toHaveLength(102);
    expect(manifest.migration).toEqual({
      status: 'implemented',
      assigned: 102,
      missing: 0,
      duplicate: 0,
      unresolved: 0,
    });
    expect(new Set(Object.keys(owners))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(Object.values(owners).every((owner) => owner.length === 1)).toBe(
      true,
    );
  });

  it('exposes precisely the 34 legacy REST routes and 58 socket capabilities', () => {
    const routes = routeSet();
    expect(new Set(routes)).toEqual(new Set(expectedRoutes));
    expect(routes).toHaveLength(34);
    expect(Object.keys(inboundEventSchemas)).toHaveLength(26);
    expect(Object.keys(outboundEventViews)).toHaveLength(25);
    expect(
      manifest.capabilityIds.filter((id) => id.startsWith('socket:')),
    ).toHaveLength(58);
  });

  it('registers each intentional correction as approved', () => {
    const registered = new Map(
      corrections.map((correction) => [correction.id, correction]),
    );
    expect(manifest.corrections).toHaveLength(9);
    for (const id of manifest.corrections) {
      expect(registered.get(id)?.status).toBe('approved');
    }
  });

  it('keeps rollback data-compatible and never creates dual writers', () => {
    const sql = readSource(
      'prisma',
      'data-migrations',
      'chat-realtime-cutover.sql',
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/u);
    expect(manifest.cutoverUnit).toEqual(manifest.capabilityIds);
    expect(owners).toEqual(
      expect.objectContaining({
        'model:model:Chat': ['chat'],
        'provider:push-notification:73e660fd0a3a': ['chat-delivery'],
      }),
    );
  });

  it('does not reintroduce unsafe legacy realtime patterns', () => {
    const source = [
      readCode('src', 'chat', 'chat.gateway.ts'),
      readCode('src', 'chat', 'signalling', 'video-calls.gateway.ts'),
      readCode('src', 'chat', 'media', 'chat-attachment.service.ts'),
      readCode('src', 'chat', 'media', 'legacy-base64-media.adapter.ts'),
      readCode('src', 'realtime', 'presence.service.ts'),
      readCode('src', 'realtime', 'socket-io-redis.adapter.ts'),
    ].join('\n');
    expect(source).not.toMatch(
      /connectedUsers|writeFile|createWriteStream|mkdir/u,
    );
    expect(source).not.toMatch(/origin\s*:\s*['"]\*/u);
    expect(source).not.toMatch(/emit\([^,]+,\s*error\.message/u);
    expect(source).toContain('assertPeers');
    expect(source).toContain('createAdapter');
  });

  it('keeps the realtime gateways inside the authenticated Nest boundary', () => {
    expect(readCode('src', 'chat', 'chat.gateway.ts')).toContain(
      'authorization.assertMember',
    );
    expect(
      readCode('src', 'chat', 'signalling', 'video-calls.gateway.ts'),
    ).toContain('authorization.assertPeers');
    expect(ChatGateway).toBeDefined();
    expect(VideoCallsGateway).toBeDefined();
  });
});
