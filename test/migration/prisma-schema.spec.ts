import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = process.cwd();
const legacyPath = resolve(
  workspace,
  '..',
  'backend',
  'prisma',
  'schema.prisma',
);
const targetPath = resolve(workspace, 'prisma', 'schema.prisma');

function read(filePath: string): string {
  return existsSync(filePath)
    ? readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    : '';
}

function modelBlocks(schema: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = match[1];
    const block = match[2];
    if (typeof name === 'string' && typeof block === 'string') {
      blocks.set(name, block);
    }
  }
  return blocks;
}

function semanticLines(block: string): string[] {
  return block
    .split('\n')
    .map((line) =>
      line
        .replace(/\/\/.*$/, '')
        .trim()
        .replace(/\s+/g, ' '),
    )
    .filter(Boolean);
}

function fieldName(line: string): string | undefined {
  return line.match(/^(\w+)\s/)?.[1];
}

/**
 * Intentional, reviewed departures from the legacy schema. Everything not
 * listed here must still match the legacy definition line for line, so an
 * accidental drift during migration still fails this suite.
 *
 * `replace` rewrites one legacy line; `add` appends a line the legacy schema
 * does not have. Neither changes a physical column, so the legacy Express
 * service keeps working against the same tables.
 */
const DIVERGENCES: Readonly<
  Record<
    string,
    {
      readonly replace?: Readonly<Record<string, string>>;
      readonly add?: readonly string[];
    }
  >
> = {
  // The physical column stays `Status`; only the Prisma field is renamed.
  Ad: {
    replace: {
      'Status String @default("draft")':
        'status String @default("draft") @map("Status")',
    },
  },
  // `interests` was an orphan table with no path to a user.
  Interest: { add: ['users UserInterest[]'] },
  // `updatedBy` held a user id with no foreign key behind it.
  VerificationSettings: {
    add: [
      'updatedByUser User? @relation("verificationSettingsUpdatedBy", fields: [updatedBy], references: [id], onDelete: SetNull)',
    ],
  },
  // Back-relations for the normalized social graph. The legacy JSON columns
  // (`posts.likes`, `comments.likes`) are still present and authoritative;
  // these are the dual-written relational tables alongside them.
  Post: { add: ['postLikes PostLike[]', 'notInterestedBy NotInterested[]'] },
  Comment: { add: ['commentLikes CommentLike[]'] },
};

function applyDivergences(name: string, lines: string[]): string[] {
  const divergence = DIVERGENCES[name];
  if (!divergence) return lines;
  const replaced = lines.map((line) => divergence.replace?.[line] ?? line);
  return [...replaced, ...(divergence.add ?? [])];
}

describe('Aeko Prisma domain preservation', () => {
  const legacy = read(legacyPath);
  const target = read(targetPath);
  const legacyModels = modelBlocks(legacy);
  const targetModels = modelBlocks(target);

  test('uses Prisma 7 client generation without embedding a datasource URL', () => {
    expect(target).toMatch(
      /generator client\s*\{\s*provider\s*=\s*"prisma-client"\s*output\s*=\s*"\.\.\/src\/generated\/prisma"\s*\}/s,
    );
    expect(target).toMatch(
      /datasource db\s*\{\s*provider\s*=\s*"postgresql"\s*\}/s,
    );
    expect(target).not.toMatch(/datasource db[\s\S]*?\burl\s*=/);
  });

  test('preserves every non-User Aeko model except for recorded divergences', () => {
    const legacyDomainModels = [...legacyModels.keys()].filter(
      (name) => name !== 'User',
    );
    expect(legacyDomainModels.length).toBeGreaterThan(20);

    for (const name of legacyDomainModels) {
      const expected = applyDivergences(
        name,
        semanticLines(legacyModels.get(name)),
      );
      expect(semanticLines(targetModels.get(name) ?? '')).toEqual(expected);
    }
  });

  test('records no divergence for a model that no longer exists', () => {
    for (const name of Object.keys(DIVERGENCES)) {
      expect([...legacyModels.keys()]).toContain(name);
    }
  });

  test('keeps one canonical users model with every non-auth Aeko field and relation', () => {
    expect([...target.matchAll(/^model\s+User\s*\{/gm)]).toHaveLength(1);
    expect(target).not.toMatch(
      /^model\s+Auth(?:User|Session|Account|Verification)\s*\{/m,
    );

    const targetUser = semanticLines(targetModels.get('User') ?? '');
    const deprecatedLegacyAuthFields = new Set([
      'password',
      'oauthId',
      'oauthProvider',
      'emailVerification',
      'twoFactorAuth',
    ]);
    const preservedUserLines = semanticLines(
      legacyModels.get('User') ?? '',
    ).filter((line) => !deprecatedLegacyAuthFields.has(fieldName(line)));

    for (const line of preservedUserLines) expect(targetUser).toContain(line);
    expect(targetUser).toContain('@@map("users")');
  });
});
