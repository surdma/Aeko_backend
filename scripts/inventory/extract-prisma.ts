import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { resolveInstalledPackage } from './legacy-source';
import type { ModelCapability } from './inventory.types';

interface PrismaDeclaration {
  readonly type?: unknown;
  readonly name?: unknown;
}

interface PrismaSchema {
  readonly list: readonly PrismaDeclaration[];
}

interface PrismaAstApi {
  getSchema(schema: string): PrismaSchema;
}

const workspaceRequire = createRequire(join(process.cwd(), 'package.json'));

function isPrismaAstApi(value: unknown): value is PrismaAstApi {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Partial<PrismaAstApi>).getSchema === 'function';
}

function declarationLine(
  schema: string,
  declarationKind: 'model' | 'enum',
  name: string,
): number {
  const pattern = new RegExp(`^\\s*${declarationKind}\\s+${name}\\s*\\{`, 'm');
  const match = pattern.exec(schema);
  if (match === null) {
    throw new Error(
      `Parsed Prisma declaration missing from source: ${declarationKind} ${name}`,
    );
  }
  return schema.slice(0, match.index).split(/\r?\n/).length;
}

export function extractPrismaCapabilities(
  legacyRoot: string,
): readonly ModelCapability[] {
  const file = 'prisma/schema.prisma';
  const schema = readFileSync(
    join(resolve(legacyRoot), 'prisma', 'schema.prisma'),
    'utf8',
  );
  const loaded: unknown = workspaceRequire(
    resolveInstalledPackage('@mrleebo/prisma-ast', 'dist/index.js'),
  );
  if (!isPrismaAstApi(loaded)) {
    throw new Error(
      'Installed @mrleebo/prisma-ast package does not expose getSchema',
    );
  }

  return loaded
    .getSchema(schema)
    .list.filter(
      (
        declaration,
      ): declaration is PrismaDeclaration & {
        readonly type: 'model' | 'enum';
        readonly name: string;
      } =>
        (declaration.type === 'model' || declaration.type === 'enum') &&
        typeof declaration.name === 'string',
    )
    .map(({ type, name }) => {
      const line = declarationLine(schema, type, name);
      return {
        id: `model:${type}:${name}`,
        kind: 'model' as const,
        source: { file, line },
        owner: 'database-foundation',
        risk: type === 'model' ? ('high' as const) : ('medium' as const),
        status: 'legacy' as const,
        declarationKind: type,
        name,
      };
    });
}
