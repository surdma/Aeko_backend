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

describe('Aeko Prisma domain preservation', () => {
  const legacy = read(legacyPath);
  const target = read(targetPath);
  const legacyModels = modelBlocks(legacy);
  const targetModels = modelBlocks(target);

  test('uses Prisma 7 client generation without embedding a datasource URL', () => {
    expect(target).toMatch(
      /generator client\s*\{\s*provider\s*=\s*"prisma-client"\s*output\s*=\s*"\.\/generated"\s*\}/s,
    );
    expect(target).toMatch(
      /datasource db\s*\{\s*provider\s*=\s*"postgresql"\s*\}/s,
    );
    expect(target).not.toMatch(/datasource db[\s\S]*?\burl\s*=/);
  });

  test('preserves every complete non-User Aeko model verbatim in semantic content', () => {
    const legacyDomainModels = [...legacyModels.keys()].filter(
      (name) => name !== 'User',
    );
    expect(legacyDomainModels.length).toBeGreaterThan(20);

    for (const name of legacyDomainModels) {
      expect(semanticLines(targetModels.get(name) ?? '')).toEqual(
        semanticLines(legacyModels.get(name)),
      );
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
