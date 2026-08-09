import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type ContentSocialOwner =
  'posts' | 'comments' | 'status' | 'explore' | 'notifications' | 'reports';

type OwnerMap = Readonly<Record<string, readonly [ContentSocialOwner]>>;

interface Manifest {
  readonly capabilityIds: readonly string[];
}

const root = join(__dirname, '..', '..');

const manifest = JSON.parse(
  readFileSync(
    join(root, 'docs', 'nestjs-migration', 'domains', 'content-social.json'),
    'utf8',
  ),
) as Manifest;

const ownersPath = join(
  root,
  'docs',
  'nestjs-migration',
  'domains',
  'content-social-owners.json',
);

const owners: OwnerMap = existsSync(ownersPath)
  ? (JSON.parse(readFileSync(ownersPath, 'utf8')) as OwnerMap)
  : Object.freeze({});

const MODULE_FILES = [
  'src/posts/posts.module.ts',
  'src/posts/posts.controller.ts',
  'src/posts/posts.service.ts',
  'src/comments/comments.module.ts',
  'src/comments/comments.controller.ts',
  'src/comments/comments.service.ts',
  'src/status/status.module.ts',
  'src/status/status.controller.ts',
  'src/status/status.service.ts',
  'src/explore/explore.module.ts',
  'src/explore/explore.controller.ts',
  'src/explore/explore.service.ts',
  'src/notifications/notifications.module.ts',
  'src/notifications/notifications.controller.ts',
  'src/notifications/notifications.service.ts',
  'src/reports/reports.module.ts',
  'src/reports/reports.controller.ts',
  'src/reports/reports.service.ts',
  'src/providers/content-chain/content-chain.port.ts',
];

const APP_MODULES = [
  'PostsModule',
  'CommentsModule',
  'StatusModule',
  'ExploreModule',
  'NotificationsModule',
  'ReportsModule',
];

describe('content social capability ownership', () => {
  it('assigns all 52 capabilities to exactly one feature owner', () => {
    expect(manifest.capabilityIds).toHaveLength(52);
    expect(new Set(Object.keys(owners))).toEqual(
      new Set(manifest.capabilityIds),
    );
    expect(Object.values(owners).every((value) => value.length === 1)).toBe(
      true,
    );
    expect(
      Object.values(owners).reduce<Record<ContentSocialOwner, number>>(
        (counts, [owner]) => ({ ...counts, [owner]: counts[owner] + 1 }),
        {
          posts: 0,
          comments: 0,
          status: 0,
          explore: 0,
          notifications: 0,
          reports: 0,
        },
      ),
    ).toEqual({
      posts: 25,
      comments: 6,
      status: 6,
      explore: 1,
      notifications: 9,
      reports: 5,
    });
  });

  it('owns every capability by the feature its path or model belongs to', () => {
    const prefixes: Readonly<Record<ContentSocialOwner, string>> = {
      posts: '/api/posts',
      comments: '/api/comments',
      status: '/api/status',
      explore: '/api/explore',
      notifications: '/api/notifications',
      reports: '/api/reports',
    };
    const models: Readonly<Record<string, ContentSocialOwner>> = {
      'model:model:Post': 'posts',
      'model:model:Bookmark': 'posts',
      'model:model:Comment': 'comments',
      'model:model:Status': 'status',
      'model:model:Notification': 'notifications',
      'model:model:Report': 'reports',
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
