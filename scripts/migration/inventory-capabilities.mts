import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  auditInventory,
  buildInventory as buildLegacyInventory,
  extractSourceCapabilities as extractLegacySourceCapabilities,
  inventoryMarkdown,
  parseEnvExample,
  parseJsonCapabilities,
  parsePrismaSchema,
  type CapabilityInventory,
  type CapabilityItem,
  type CapabilityKind,
  type InventoryAudit,
  type InventoryAuditCategory,
} from './inventory-legacy.mjs';

export {
  auditInventory,
  inventoryMarkdown,
  parseEnvExample,
  parseJsonCapabilities,
  parsePrismaSchema,
};
export type {
  CapabilityInventory,
  CapabilityItem,
  CapabilityKind,
  InventoryAudit,
  InventoryAuditCategory,
};

const sourceExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts']);
const selectedDirectories = [
  'routes',
  'middleware',
  'sockets',
  'jobs',
  'config',
  'services',
  'chain',
];

function canonicalEvidence(evidence: Readonly<Record<string, string>>): readonly [string, string][] {
  return Object.entries(evidence)
    .filter(([key]) => key !== 'line')
    .sort(([left], [right]) => left.localeCompare(right));
}

function stableId(
  kind: CapabilityKind,
  sourceFile: string,
  evidence: Readonly<Record<string, string>>,
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        kind,
        sourceFile.replaceAll('\\', '/'),
        canonicalEvidence(evidence),
      ]),
    )
    .digest('hex')
    .slice(0, 12);
  return `${kind}:${digest}`;
}

function moduleNameFromFile(sourceFile: string): string {
  const normalized = sourceFile.replaceAll('\\', '/');
  const stem = basename(normalized, extname(normalized))
    .replace(/Routes?$/iu, '')
    .replace(/Socket$/iu, '')
    .replace(/Service$/iu, '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase();
  return stem || 'legacy-unassigned';
}

function supplementalItem(
  kind: 'operation' | 'persistence',
  sourceFile: string,
  evidence: Record<string, string>,
): CapabilityItem {
  return {
    id: stableId(kind, sourceFile, evidence),
    kind,
    sourceFile,
    legacyOwner: 'Express',
    risk: 'high',
    targetModule:
      kind === 'operation' && evidence.category === 'environment-variable'
        ? 'configuration'
        : moduleNameFromFile(sourceFile),
    parityCases:
      kind === 'operation'
        ? [
            `Preserve ${evidence.name ?? evidence.category ?? 'operation'} startup, deployment, configuration, and rollback behavior`,
          ]
        : [
            `Preserve ${evidence.operation ?? 'persistence'} transaction, concurrency, and numeric semantics`,
          ],
    status: 'legacy-only',
    reviewVerdict: 'pending',
    cutoverState: 'express-owner',
    rollbackState: 'legacy-available',
    evidence,
  };
}

function lineNumber(source: ts.SourceFile, node: ts.Node): string {
  return String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
}

function environmentName(node: ts.Node, source: ts.SourceFile): string | undefined {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.getText(source) === 'process.env'
  ) {
    return node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.getText(source) === 'process.env'
  ) {
    const argument = node.argumentExpression;
    return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
  }
  return undefined;
}

function rawPrismaOperation(
  tag: ts.LeftHandSideExpression,
  source: ts.SourceFile,
): string | undefined {
  if (ts.isPropertyAccessExpression(tag) && tag.expression.getText(source) === 'prisma') {
    return tag.name.text.startsWith('$') ? tag.name.text : undefined;
  }
  if (
    ts.isElementAccessExpression(tag) &&
    tag.expression.getText(source) === 'prisma' &&
    tag.argumentExpression &&
    ts.isStringLiteralLike(tag.argumentExpression) &&
    tag.argumentExpression.text.startsWith('$')
  ) {
    return tag.argumentExpression.text;
  }
  return undefined;
}

function extractSupplementalSourceCapabilities(
  sourceFile: string,
  sourceText: string,
): CapabilityItem[] {
  const source = ts.createSourceFile(
    sourceFile,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const results: CapabilityItem[] = [];

  const visit = (node: ts.Node): void => {
    const name = environmentName(node, source);
    if (name !== undefined) {
      results.push(
        supplementalItem('operation', sourceFile, {
          category: 'environment-variable',
          name,
        }),
      );
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const operation = rawPrismaOperation(node.tag, source);
      if (operation !== undefined) {
        results.push(
          supplementalItem('persistence', sourceFile, {
            client: 'prisma',
            operation,
            line: lineNumber(source, node),
          }),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return results;
}

function deduplicate(items: readonly CapabilityItem[]): CapabilityItem[] {
  const unique = new Map<string, CapabilityItem>();
  for (const capability of items) unique.set(capability.id, capability);
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function extractSourceCapabilities(
  sourceFile: string,
  sourceText: string,
): CapabilityItem[] {
  return deduplicate([
    ...extractLegacySourceCapabilities(sourceFile, sourceText),
    ...extractSupplementalSourceCapabilities(sourceFile, sourceText),
  ]);
}

async function walkDirectory(root: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(root, entry.name);
      return entry.isDirectory() ? walkDirectory(path) : [path];
    }),
  );
  return nested.flat();
}

async function supplementalFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const directory of selectedDirectories) {
    files.push(...(await walkDirectory(resolve(root, directory))));
  }
  for (const rootFile of ['server.js', 'admin.js']) {
    const path = resolve(root, rootFile);
    try {
      await readFile(path);
      files.push(path);
    } catch {
      // Optional legacy entrypoints are already represented by the base inventory audit.
    }
  }
  return [...new Set(files)].filter((file) => sourceExtensions.has(extname(file)));
}

export async function buildInventory(
  legacyWorktree: string,
): Promise<CapabilityInventory> {
  const base = await buildLegacyInventory(legacyWorktree);
  const absoluteRoot = resolve(legacyWorktree);
  const additions: CapabilityItem[] = [];

  for (const absoluteFile of await supplementalFiles(absoluteRoot)) {
    const sourceFile = relative(absoluteRoot, absoluteFile).replaceAll('\\', '/');
    const sourceText = await readFile(absoluteFile, 'utf8');
    additions.push(...extractSupplementalSourceCapabilities(sourceFile, sourceText));
  }

  const inventory: CapabilityInventory = {
    ...base,
    items: deduplicate([...base.items, ...additions]),
  };
  inventory.audit = auditInventory(inventory);
  return inventory;
}
