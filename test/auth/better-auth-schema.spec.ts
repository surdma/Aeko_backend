import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = process.cwd();
const paths = {
  config: resolve(workspace, 'src', 'lib', 'auth', 'auth.schema.ts'),
  generated: resolve(workspace, 'prisma', 'better-auth.generated.prisma'),
  target: resolve(workspace, 'prisma', 'schema.prisma'),
  migration: resolve(
    workspace,
    'prisma',
    'migrations',
    '20260808_add_better_auth_compatibility',
    'migration.sql',
  ),
};

function read(filePath: string): string {
  return existsSync(filePath)
    ? readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    : '';
}

function modelBlock(schema: string, name: string): string {
  return (
    schema.match(
      new RegExp(`^model\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm'),
    )?.[1] ?? ''
  );
}

function fieldNames(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim().match(/^(\w+)\s/)?.[1])
    .filter((fieldName): fieldName is string => fieldName !== undefined);
}

describe('native Better Auth schema provenance', () => {
  const config = read(paths.config);
  const generated = read(paths.generated);
  const target = read(paths.target);
  const migration = read(paths.migration);
  const cliProvenanceTest = generated ? test : test.skip;

  test('uses an isolated Aeko schema-only Better Auth configuration', () => {
    expect(config).toMatch(/appName:\s*['"]Aeko['"]/);
    expect(config).toMatch(/prismaAdapter\s*\(/);
    expect(config).toMatch(/emailAndPassword:\s*\{\s*enabled:\s*true/s);
    expect(config).toMatch(/socialProviders:[\s\S]*google/);
    expect(config).toMatch(/plugins:\s*\[\s*bearer\(\),\s*twoFactor\(\)\s*\]/s);
    expect(config).toMatch(/new\s+PrismaClient\s*\(/);
    expect(config).toMatch(/new\s+PrismaPg\s*\(/);
    expect(config).not.toMatch(/\bas\s+(?:any|never|unknown)\b/);
    expect(config).not.toMatch(
      /@verilo|express|passport|jsonwebtoken|\bjwt\b|bcrypt|email-templates|legacy/i,
    );
    expect(config).not.toMatch(
      /\b(migrate|migrateDev|migrateDeploy|dbPush|executeRaw|queryRaw)\b/i,
    );
  });

  cliProvenanceTest(
    'retains unedited official CLI models and approved plugin storage names',
    () => {
      for (const name of [
        'User',
        'Session',
        'Account',
        'Verification',
        'TwoFactor',
      ]) {
        expect(generated).toMatch(new RegExp(`^model\\s+${name}\\s*\\{`, 'm'));
      }
      expect(generated).not.toMatch(
        /^model\s+Auth(?:User|Session|Account|Verification)\s*\{/m,
      );
    },
  );

  cliProvenanceTest(
    'merges official auth fields into canonical User and preserves official auth models',
    () => {
      for (const name of ['Session', 'Account', 'Verification', 'TwoFactor']) {
        expect(modelBlock(target, name).trim()).toBe(
          modelBlock(generated, name).trim(),
        );
      }

      const generatedUserFields = fieldNames(modelBlock(generated, 'User'));
      const targetUserFields = fieldNames(modelBlock(target, 'User'));
      for (const name of generatedUserFields)
        expect(targetUserFields).toContain(name);
      expect(modelBlock(target, 'User')).toMatch(
        /twoFactorEnabled\s+Boolean\?\s+@default\(false\)/,
      );
      expect(modelBlock(target, 'User')).toMatch(/twofactors\s+TwoFactor\[\]/);
      expect(modelBlock(target, 'User')).not.toMatch(
        /twoFactors\s+TwoFactor\[\]/,
      );
      expect([...target.matchAll(/^model\s+User\s*\{/gm)]).toHaveLength(1);
      expect(modelBlock(target, 'User')).toContain('@@map("users")');
    },
  );

  test('does not expose legacy credential columns as Prisma auth storage', () => {
    const targetUserFields = new Set(fieldNames(modelBlock(target, 'User')));
    for (const name of [
      'password',
      'oauthId',
      'oauthProvider',
      'emailVerification',
      'twoFactorAuth',
    ]) {
      expect(targetUserFields.has(name)).toBe(false);
    }
    expect(fieldNames(modelBlock(target, 'Account'))).toContain('password');
  });

  test('migration is additive and never copies or destroys legacy auth data', () => {
    expect(migration).toMatch(/CREATE TABLE\s+"(?:session|Session)"/i);
    expect(migration).toMatch(/CREATE TABLE\s+"(?:account|Account)"/i);
    expect(migration).toMatch(
      /CREATE TABLE\s+"(?:verification|Verification)"/i,
    );
    expect(migration).toMatch(/CREATE TABLE\s+"(?:twoFactor|TwoFactor)"/i);
    expect(migration).toMatch(
      /"twoFactorEnabled"\s+BOOLEAN\s+DEFAULT\s+false/i,
    );
    expect(migration).toMatch(/"verified"\s+BOOLEAN\s+DEFAULT\s+true/i);
    expect(migration).toMatch(
      /"failedVerificationCount"\s+INTEGER\s+DEFAULT\s+0/i,
    );
    expect(migration).not.toMatch(
      /"(?:twoFactorEnabled|verified|failedVerificationCount)"\s+(?:BOOLEAN|INTEGER)\s+NOT\s+NULL/i,
    );
    expect(migration).not.toMatch(
      /\b(DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX)|TRUNCATE|RENAME)\b/i,
    );
    expect(migration).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+.+\s+SET|CREATE\s+TABLE\s+AS|SELECT\s+.+\s+INTO)\b/is,
    );
  });
});
