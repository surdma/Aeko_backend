import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { ChallengesController } from '../../src/challenges/challenges.controller';
import { DebatesController } from '../../src/debates/debates.controller';
import { SpacesController } from '../../src/spaces/spaces.controller';

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
  readonly migration?: Migration;
}

interface Correction {
  readonly id: string;
  readonly status: string;
}

const readJson = (...path: readonly string[]): unknown =>
  JSON.parse(readFileSync(join(ROOT, ...path), 'utf8')) as unknown;

const manifest = readJson(
  'docs',
  'nestjs-migration',
  'domains',
  'debates-challenges-spaces.json',
) as Manifest;

const corrections = readJson(
  'docs',
  'nestjs-migration',
  'corrections.json',
) as readonly Correction[];

const readSource = (...path: readonly string[]): string =>
  readFileSync(join(ROOT, ...path), 'utf8');

/**
 * Comments describe the legacy defects on purpose, so the Express-era patterns
 * below are asserted against code only.
 */
const readCode = (...path: readonly string[]): string =>
  readSource(...path)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');

const SOURCES = [
  ['src', 'debates', 'debates.service.ts'],
  ['src', 'debates', 'debates.controller.ts'],
  ['src', 'challenges', 'challenges.service.ts'],
  ['src', 'challenges', 'challenges.controller.ts'],
  ['src', 'spaces', 'spaces.service.ts'],
  ['src', 'spaces', 'spaces.controller.ts'],
];

const reflector = new Reflector();

const routesOf = (controller: { readonly prototype: object }): string[] => {
  const root: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  const prefix = typeof root === 'string' && root !== '/' ? root : '';
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler: unknown = Reflect.get(controller.prototype, name);
      if (typeof handler !== 'function') return [];
      const path = reflector.get<unknown>(PATH_METADATA, handler);
      const method = reflector.get<unknown>(METHOD_METADATA, handler);
      if (typeof path !== 'string') return [];
      const verb =
        method === RequestMethod.POST
          ? 'POST'
          : method === RequestMethod.PUT
            ? 'PUT'
            : method === RequestMethod.PATCH
              ? 'PATCH'
              : method === RequestMethod.DELETE
                ? 'DELETE'
                : 'GET';
      const segments = [prefix, path === '/' ? '' : path].filter(
        (segment) => segment !== '',
      );
      return [`${verb} /${segments.join('/')}`];
    });
};

const allRoutes = [
  ...routesOf(DebatesController),
  ...routesOf(ChallengesController),
  ...routesOf(SpacesController),
];

const LEGACY_ROUTES = [
  'POST /api/debates/start',
  'PUT /api/debates/:debateId/score',
  'PUT /api/debates/:debateId/vote',
  'PUT /api/debates/:debateId/end',
  'GET /api/debates',
  'POST /api/challenges/create',
  'PUT /api/challenges/:challengeId/duet',
  'PUT /api/challenges/:challengeId/vote',
  'PUT /api/challenges/:challengeId/end',
  'GET /api/challenges',
  'POST /api/spaces/create',
  'PATCH /api/spaces/:spaceId/end',
  'PUT /api/spaces/:spaceId/highlight',
];

describe('debates challenges spaces cutover', () => {
  it('exposes exactly the thirteen legacy routes, with no additions', () => {
    expect(new Set(allRoutes)).toEqual(new Set(LEGACY_ROUTES));
    expect(allRoutes).toHaveLength(LEGACY_ROUTES.length);
  });

  it('records 16/16 closure in the domain manifest', () => {
    expect(manifest.capabilityIds).toHaveLength(16);
    expect(manifest.migration).toEqual({
      status: 'implemented',
      assigned: 16,
      missing: 0,
      duplicate: 0,
      unresolved: 0,
    });
  });

  it('registers every correction, and carries the pending one openly', () => {
    const registered = new Map(
      corrections.map((correction) => [correction.id, correction]),
    );
    expect(manifest.corrections.length).toBeGreaterThan(0);
    for (const id of manifest.corrections) {
      expect(registered.get(id)?.status).toMatch(
        /^(approved|pending-schema)$/u,
      );
    }
    // Debate ballot stuffing is not fixed; it must stay visible as pending.
    expect(
      registered.get('correction:debate-vote-ballot-stuffing')?.status,
    ).toBe('pending-schema');
  });

  it('never reads a voter identity from a request body', () => {
    for (const path of SOURCES) {
      const source = readCode(...path);
      expect(source).not.toMatch(/body\.userId/u);
      expect(source).not.toContain('req.body');
      expect(source).not.toContain('req.user');
      expect(source).not.toContain('res.status');
      expect(source).not.toMatch(/error:\s*error\.message/u);
    }
  });

  it('keeps the non-existent creator relation out of the challenge boundary', () => {
    const source = readSource(
      'src',
      'challenges',
      'challenge-prisma.client.ts',
    );
    expect(source).not.toMatch(/include:\s*\{\s*creator:/u);
    expect(source).toContain('user: { select: creatorSelect }');
  });
});
