import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  auditInventory,
  buildInventory as buildCompleteInventory,
  type CapabilityItem,
} from './inventory-capabilities.mjs';
import { buildInventory as buildLegacyInventory } from './inventory-legacy.mjs';
import {
  buildResolvedInventory as buildLegacyResolvedInventory,
  resolvedInventoryMarkdown,
  type ResolvedCapabilityInventory,
} from './inventory-resolved.mjs';

export { resolvedInventoryMarkdown };
export type { ResolvedCapabilityInventory };

function mergeByStableId(
  base: readonly CapabilityItem[],
  additions: readonly CapabilityItem[],
): CapabilityItem[] {
  const unique = new Map<string, CapabilityItem>();
  for (const capability of base) unique.set(capability.id, capability);
  for (const capability of additions) unique.set(capability.id, capability);
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function buildResolvedInventory(
  legacyWorktree: string,
): Promise<ResolvedCapabilityInventory> {
  const [resolved, legacyBaseline, completeBaseline] = await Promise.all([
    buildLegacyResolvedInventory(legacyWorktree),
    buildLegacyInventory(legacyWorktree),
    buildCompleteInventory(legacyWorktree),
  ]);
  const legacyIds = new Set(legacyBaseline.items.map(({ id }) => id));
  const supplemental = completeBaseline.items.filter(({ id }) => !legacyIds.has(id));
  const inventory: ResolvedCapabilityInventory = {
    ...resolved,
    items: mergeByStableId(resolved.items, supplemental),
  };
  inventory.audit = auditInventory(inventory);
  return inventory;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const legacyWorktree =
    argumentValue('--legacy-worktree') ?? process.env.LEGACY_WORKTREE;
  if (legacyWorktree === undefined) {
    throw new Error('Provide --legacy-worktree or LEGACY_WORKTREE');
  }

  const inventory = await buildResolvedInventory(legacyWorktree);
  const outputRoot = resolve('docs/nestjs-migration');
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(outputRoot, 'capability-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    ),
    writeFile(
      resolve(outputRoot, 'capability-inventory.md'),
      resolvedInventoryMarkdown(inventory),
    ),
  ]);

  const audit = inventory.audit ?? auditInventory(inventory);
  process.stdout.write(
    `${inventory.items.length} capabilities written; ${audit.unknownCount} unknown; ${audit.missingCategories.length} missing categories\n`,
  );
}
