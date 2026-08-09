import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { AdsController } from '../../src/ads/ads.controller';
import { MediaProcessingController } from '../../src/providers/media-processing/media-processing.controller';

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
  'ads-media.json',
) as Manifest;

const corrections = readJson(
  'docs',
  'nestjs-migration',
  'corrections.json',
) as readonly Correction[];

const readSource = (...path: readonly string[]): string =>
  readFileSync(join(ROOT, ...path), 'utf8');

const ADS_SOURCES = [
  ['src', 'ads', 'ads.controller.ts'],
  ['src', 'ads', 'ads.service.ts'],
  ['src', 'ads', 'ad.contract.ts'],
  ['src', 'ads', 'ad-prisma.client.ts'],
];

const MEDIA_SOURCES = [
  ['src', 'providers', 'media-processing', 'media-processing.controller.ts'],
  ['src', 'providers', 'media-processing', 'media-processing.service.ts'],
  ['src', 'providers', 'media-processing', 'sharp-image.adapter.ts'],
  ['src', 'providers', 'media-processing', 'ffmpeg-video.adapter.ts'],
];

const routesOf = (controller: {
  readonly prototype: object;
}): readonly string[] => {
  const reflector = new Reflector();
  const root: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  const prefix = typeof root === 'string' && root !== '/' ? root : '';
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler: unknown = Reflect.get(controller.prototype, name);
      if (typeof handler !== 'function') return [];
      const path: unknown = reflector.get<unknown>(PATH_METADATA, handler);
      const method: unknown = reflector.get<unknown>(METHOD_METADATA, handler);
      if (typeof path !== 'string') return [];
      const verb =
        method === RequestMethod.POST
          ? 'POST'
          : method === RequestMethod.PUT
            ? 'PUT'
            : method === RequestMethod.DELETE
              ? 'DELETE'
              : 'GET';
      const segments = [prefix, path === '/' ? '' : path].filter(
        (segment) => segment !== '',
      );
      return [`${verb} /${segments.join('/')}`];
    });
};

describe('ads-media cutover', () => {
  it('exposes exactly the fifteen legacy routes', () => {
    const routes = new Set([
      ...routesOf(AdsController),
      ...routesOf(MediaProcessingController),
    ]);

    expect(routes).toEqual(
      new Set([
        'POST /api/ads',
        'GET /api/ads',
        'GET /api/ads/targeted',
        'GET /api/ads/dashboard',
        'POST /api/ads/track/impression',
        'POST /api/ads/track/click',
        'POST /api/ads/track/conversion',
        'POST /api/ads/track-view',
        'GET /api/ads/:adId/analytics',
        'PUT /api/ads/:adId',
        'DELETE /api/ads/:adId',
        'GET /api/ads/admin/review',
        'POST /api/ads/admin/review/:adId',
        'POST /api/photo/edit',
        'POST /api/video/edit',
      ]),
    );
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

  it('registers every ads-media correction as approved', () => {
    const registered = new Map(
      corrections.map((correction) => [correction.id, correction]),
    );
    expect(manifest.corrections.length).toBeGreaterThan(0);
    for (const id of manifest.corrections) {
      expect(registered.get(id)?.status).toBe('approved');
    }
  });

  it('writes ad status only through the canonical column', () => {
    for (const path of ADS_SOURCES) {
      const source = readSource(...path);
      // A Prisma write must never carry the lowercase legacy field.
      expect(source).not.toMatch(/data:\s*\{[^}]*\bstatus\s*:/u);
    }
    // The internal column name is confined to the boundary file.
    expect(readSource('src', 'ads', 'ads.service.ts')).not.toContain(
      "'Status'",
    );
    expect(readSource('src', 'ads', 'ad-prisma.client.ts')).toContain('Status');
  });

  it('keeps no Express-era upload or shell patterns', () => {
    for (const path of [...ADS_SOURCES, ...MEDIA_SOURCES]) {
      const source = readSource(...path);
      expect(source).not.toMatch(
        /writeFileSync|multer\(\{\s*dest|shell:\s*true/u,
      );
      expect(source).not.toContain('fluent-ffmpeg');
      expect(source).not.toContain('req.body');
    }
    expect(
      readSource(
        'src',
        'providers',
        'media-processing',
        'ffmpeg-video.adapter.ts',
      ),
    ).toContain('shell: false');
  });
});
