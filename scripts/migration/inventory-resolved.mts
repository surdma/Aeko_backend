import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import ts from 'typescript';
import {
  auditInventory,
  buildInventory,
  inventoryMarkdown,
  type CapabilityInventory,
  type CapabilityItem,
  type CapabilityKind,
} from './inventory-legacy.mjs';

export interface LegacySourceState {
  readonly commit: string;
  readonly dirty: boolean;
  readonly dirtyFiles: readonly string[];
}

export interface ResolvedCapabilityInventory extends CapabilityInventory {
  readonly sourceState: LegacySourceState;
}

export interface RouterMount {
  readonly sourceFile: string;
  readonly routerIdentifier: string;
  readonly prefix: string;
  readonly middleware: readonly string[];
  readonly line: number;
}

function normalizeSourcePath(value: string): string {
  return value.replaceAll('\\', '/');
}

function normalizeImportedFile(sourceFile: string, moduleSpecifier: string): string {
  const sourceDirectory = posix.dirname(normalizeSourcePath(sourceFile));
  return posix.normalize(posix.join(sourceDirectory, moduleSpecifier));
}

function resolveStaticStrings(source: ts.SourceFile): ReadonlyMap<string, string> {
  const constants = new Map<string, string>();

  const resolveString = (node: ts.Node | undefined): string | undefined => {
    if (node === undefined) return undefined;
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) return constants.get(node.text);
    if (ts.isParenthesizedExpression(node)) return resolveString(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveString(node.left);
      const right = resolveString(node.right);
      return left === undefined || right === undefined ? undefined : `${left}${right}`;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const expression = resolveString(span.expression);
        if (expression === undefined) return undefined;
        value += `${expression}${span.literal.text}`;
      }
      return value;
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const value = resolveString(node.initializer);
      if (value !== undefined) constants.set(node.name.text, value);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return constants;
}

function staticString(
  node: ts.Node | undefined,
  constants: ReadonlyMap<string, string>,
): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return constants.get(node.text);
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression, constants);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left, constants);
    const right = staticString(node.right, constants);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = staticString(span.expression, constants);
      if (expression === undefined) return undefined;
      value += `${expression}${span.literal.text}`;
    }
    return value;
  }
  return undefined;
}

function importBindings(sourceFile: string, source: ts.SourceFile): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier.text;
    const importedFile = normalizeImportedFile(sourceFile, moduleSpecifier);
    if (!importedFile.startsWith('routes/')) continue;

    const clause = statement.importClause;
    if (clause?.name !== undefined) bindings.set(clause.name.text, importedFile);

    const namedBindings = clause?.namedBindings;
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      bindings.set(namedBindings.name.text, importedFile);
    }
    if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.set(element.name.text, importedFile);
      }
    }
  }

  return bindings;
}

export function extractRouterMounts(sourceFile: string, sourceText: string): readonly RouterMount[] {
  const source = ts.createSourceFile(sourceFile, sourceText, ts.ScriptTarget.Latest, true);
  const constants = resolveStaticStrings(source);
  const bindings = importBindings(sourceFile, source);
  const mounts: RouterMount[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'use' &&
      node.expression.expression.getText(source) === 'app'
    ) {
      const firstArgument = node.arguments[0];
      const explicitPrefix = staticString(firstArgument, constants);
      const firstArgumentIsRouter =
        firstArgument !== undefined &&
        ts.isIdentifier(firstArgument) &&
        bindings.has(firstArgument.text);

      if (explicitPrefix === undefined && !firstArgumentIsRouter) {
        ts.forEachChild(node, visit);
        return;
      }

      const argumentOffset = explicitPrefix === undefined ? 0 : 1;
      const prefix = explicitPrefix ?? '/';

      node.arguments.slice(argumentOffset).forEach((argument, index) => {
        if (!ts.isIdentifier(argument)) return;
        const mountedSource = bindings.get(argument.text);
        if (mountedSource === undefined) return;

        const middleware = node.arguments
          .slice(argumentOffset, argumentOffset + index)
          .map((candidate) => candidate.getText(source));

        mounts.push({
          sourceFile: mountedSource,
          routerIdentifier: argument.text,
          prefix,
          middleware,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return mounts;
}

function joinPublicPath(prefix: string, routerPath: string): string {
  const normalizedPrefix = prefix === '/' ? '' : `/${prefix.replace(/^\/+|\/+$/gu, '')}`;
  if (routerPath === '<global>' || routerPath === '/') return normalizedPrefix || '/';
  const normalizedRouterPath = routerPath.replace(/^\/+/, '');
  return `${normalizedPrefix}/${normalizedRouterPath}` || '/';
}

function derivedCapabilityId(
  kind: CapabilityKind,
  sourceId: string,
  discriminator: string,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([kind, sourceId, discriminator]))
    .digest('hex')
    .slice(0, 12);
  return `${kind}:${digest}`;
}

function resolvedCapability(capability: CapabilityItem, mount: RouterMount): CapabilityItem {
  const routerPath = capability.evidence.path ?? '<unknown>';
  const path = joinPublicPath(mount.prefix, routerPath);
  const method = capability.evidence.method ?? 'USE';

  return {
    ...capability,
    id: derivedCapabilityId(capability.kind, capability.id, `${mount.sourceFile}:${path}`),
    parityCases: [
      `Preserve ${method} ${path} auth, middleware order, status, response envelope, and effects`,
    ],
    evidence: {
      ...capability.evidence,
      path,
      routerPath,
      mountPrefix: mount.prefix,
      mountIdentifier: mount.routerIdentifier,
      mountMiddleware: JSON.stringify(mount.middleware),
      mountLine: String(mount.line),
      mountStatus: 'mounted',
    },
  };
}

function unmountedCapability(capability: CapabilityItem): CapabilityItem {
  const routerPath = capability.evidence.path ?? '<unknown>';
  return {
    ...capability,
    id: derivedCapabilityId('unknown', capability.id, 'unmounted'),
    kind: 'unknown',
    risk: 'unknown',
    targetModule: 'unassigned',
    parityCases: [
      `Classify unmounted ${capability.evidence.method ?? capability.kind} ${routerPath} before migration`,
    ],
    evidence: {
      ...capability.evidence,
      registrationKind: capability.kind,
      routerPath,
      detail: 'unmounted-router-registration',
      mountStatus: 'unmounted',
    },
  };
}

export function resolveMountedCapabilities(
  capabilities: readonly CapabilityItem[],
  mounts: readonly RouterMount[],
): CapabilityItem[] {
  const mountsBySource = new Map<string, RouterMount[]>();
  for (const mount of mounts) {
    const current = mountsBySource.get(mount.sourceFile) ?? [];
    current.push(mount);
    mountsBySource.set(mount.sourceFile, current);
  }

  return capabilities.flatMap((capability) => {
    const sourceFile = normalizeSourcePath(capability.sourceFile);
    const isRouterRegistration =
      sourceFile.startsWith('routes/') &&
      (capability.kind === 'http-route' || capability.kind === 'middleware');

    if (!isRouterRegistration) return [capability];

    const sourceMounts = mountsBySource.get(sourceFile) ?? [];
    if (sourceMounts.length === 0) return [unmountedCapability(capability)];
    return sourceMounts.map((mount) => resolvedCapability(capability, mount));
  });
}

function runGit(legacyWorktree: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      ['-C', legacyWorktree, ...args],
      { encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          rejectPromise(
            new Error(`Unable to record legacy Git state: ${stderr.trim() || error.message}`, {
              cause: error,
            }),
          );
          return;
        }
        resolvePromise(stdout.trim());
      },
    );
  });
}

export async function readLegacySourceState(legacyWorktree: string): Promise<LegacySourceState> {
  const [commit, status] = await Promise.all([
    runGit(legacyWorktree, ['rev-parse', 'HEAD']),
    runGit(legacyWorktree, ['status', '--short']),
  ]);
  const dirtyFiles = status.length === 0 ? [] : status.split(/\r?\n/u);

  return {
    commit,
    dirty: dirtyFiles.length > 0,
    dirtyFiles: Object.freeze(dirtyFiles),
  };
}

export async function buildResolvedInventory(
  legacyWorktree: string,
): Promise<ResolvedCapabilityInventory> {
  const absoluteRoot = resolve(legacyWorktree);
  const [baseline, sourceState, serverSource] = await Promise.all([
    buildInventory(absoluteRoot),
    readLegacySourceState(absoluteRoot),
    readFile(resolve(absoluteRoot, 'server.js'), 'utf8'),
  ]);
  const mounts = extractRouterMounts('server.js', serverSource);
  const items = resolveMountedCapabilities(baseline.items, mounts);
  const inventory: ResolvedCapabilityInventory = {
    ...baseline,
    sourceState,
    items,
  };

  inventory.audit = auditInventory(inventory);
  return inventory;
}

export function resolvedInventoryMarkdown(inventory: ResolvedCapabilityInventory): string {
  const snapshot = [
    '## Legacy source snapshot',
    '',
    `- Commit: \`${inventory.sourceState.commit}\``,
    `- Dirty: \`${String(inventory.sourceState.dirty)}\``,
    `- Dirty entries: ${inventory.sourceState.dirtyFiles.length}`,
    '',
  ].join('\n');

  return inventoryMarkdown(inventory).replace(
    '# Legacy capability inventory\n\n',
    `# Legacy capability inventory\n\n${snapshot}`,
  );
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const legacyWorktree = argumentValue('--legacy-worktree') ?? process.env.LEGACY_WORKTREE;
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
