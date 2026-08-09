import {
  listFiles,
  literalText,
  parseJavaScript,
  sourceLine,
  visitAst,
} from './legacy-source';
import type {
  DuplicateRouteDiagnostic,
  InactiveCapability,
  RestCapability,
  UnresolvedDiagnostic,
} from './inventory.types';

interface RouterMount {
  readonly file: string;
  readonly identifier: string;
  readonly mountPath: string;
  readonly middleware: readonly string[];
  readonly line: number;
}

export interface RestExtraction {
  readonly routes: readonly RestCapability[];
  readonly inactive: readonly InactiveCapability[];
  readonly mountedRouterModules: readonly string[];
  readonly duplicates: readonly DuplicateRouteDiagnostic[];
  readonly unresolved: readonly UnresolvedDiagnostic[];
}

const ROUTE_METHODS = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
] as const);

function normalizePath(path: string): string {
  const normalized = `/${path}`.replace(/\/+/g, '/').replace(/\/{2,}/g, '/');
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

function composePath(mountPath: string, routePath: string): string {
  if (routePath === '/') return normalizePath(mountPath);
  return normalizePath(`${mountPath}/${routePath}`);
}

function routePatternShadows(earlier: string, later: string): boolean {
  const earlierSegments = earlier.split('/').filter(Boolean);
  const laterSegments = later.split('/').filter(Boolean);
  if (earlierSegments.length !== laterSegments.length) return false;
  return earlierSegments.every((segment, index) => {
    const laterSegment = laterSegments[index];
    return (
      laterSegment !== undefined &&
      (segment === laterSegment || segment.startsWith(':') || segment === '*')
    );
  });
}

function ownerForMount(mountPath: string): string {
  if (/^\/api\/(auth|users|profile|security)/.test(mountPath)) {
    return 'auth-users-security';
  }
  if (
    /^\/api\/(posts|comments|status|explore|notifications|reports)/.test(
      mountPath,
    )
  ) {
    return 'content-social';
  }
  if (/^\/api\/(debates|challenges|spaces)/.test(mountPath)) {
    return 'debates-challenges-spaces';
  }
  if (/^\/api\/(communities|community)/.test(mountPath)) return 'communities';
  if (/^\/api\/(chat|enhanced-chat|bot|enhanced-bot)/.test(mountPath)) {
    return 'chat-realtime';
  }
  if (mountPath.startsWith('/api/livestream')) return 'livestream';
  if (/^\/api\/(ads|video|photo)/.test(mountPath)) return 'ads-media';
  if (
    /^\/api\/(payments|subscription|subscription-plans|webhooks|coins)/.test(
      mountPath,
    )
  ) {
    return 'payments-subscriptions';
  }
  if (/^\/api\/(wallet|nfts|marketplace|rewards|staking)/.test(mountPath)) {
    return 'chain';
  }
  return 'admin-support-jobs';
}

function riskForMount(mountPath: string): RestCapability['risk'] {
  if (/webhooks|wallet|nfts|marketplace|staking|coins/.test(mountPath))
    return 'critical';
  if (
    /auth|security|admin|payments|subscription|community\/payment/.test(
      mountPath,
    )
  ) {
    return 'high';
  }
  if (/chat|livestream|communities|posts|reports/.test(mountPath))
    return 'medium';
  return 'low';
}

function extractRouteImports(legacyRoot: string): ReadonlyMap<string, string> {
  const parsed = parseJavaScript(legacyRoot, 'server.js');
  const imports = new Map<string, string>();
  const importPattern =
    /^import\s+([A-Za-z_$][\w$]*)[\s\S]*?\sfrom\s+["']\.\/routes\/([^"']+\.js)["'];?$/;

  visitAst(parsed, (node) => {
    const text = node.getText(parsed.sourceFile);
    if (!text.startsWith('import ')) return;
    const match = importPattern.exec(text);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      imports.set(match[1], `routes/${match[2]}`);
    }
  });
  return imports;
}

function resolveMounts(
  legacyRoot: string,
  routeImports: ReadonlyMap<string, string>,
): {
  readonly mounts: readonly RouterMount[];
  readonly unresolved: readonly UnresolvedDiagnostic[];
} {
  const parsed = parseJavaScript(legacyRoot, 'server.js');
  const mounts: RouterMount[] = [];
  const unresolved: UnresolvedDiagnostic[] = [];

  visitAst(parsed, (node) => {
    if (!parsed.ts.isCallExpression(node)) return;
    if (node.expression.getText(parsed.sourceFile) !== 'app.use') return;

    const argumentTexts = node.arguments.map((argument) =>
      argument.getText(parsed.sourceFile),
    );
    const referencedImports = [...routeImports.entries()].filter(
      ([identifier]) =>
        argumentTexts.some((text) =>
          new RegExp(`\\b${identifier}\\b`).test(text),
        ),
    );
    if (referencedImports.length === 0) return;

    const routeFiles = [...new Set(referencedImports.map(([, file]) => file))];
    const mountPath = literalText(parsed, node.arguments[0]);
    if (routeFiles.length !== 1 || mountPath === undefined) {
      unresolved.push({
        category: 'mount',
        source: { file: 'server.js', line: sourceLine(parsed, node) },
        expression: node.getText(parsed.sourceFile),
        reason:
          routeFiles.length !== 1
            ? 'mount references multiple route modules'
            : 'mount path is not a string literal',
      });
      return;
    }

    const selected = referencedImports.find(
      ([, file]) => file === routeFiles[0],
    );
    if (selected === undefined) return;
    const [identifier, file] = selected;
    const routerArgumentIndex = argumentTexts.findIndex((text) =>
      new RegExp(`\\b${identifier}\\b`).test(text),
    );
    mounts.push({
      file,
      identifier,
      mountPath: normalizePath(mountPath),
      middleware: argumentTexts.slice(1, routerArgumentIndex),
      line: sourceLine(parsed, node),
    });
  });

  return { mounts, unresolved };
}

function extractRoutesForMount(
  legacyRoot: string,
  mount: RouterMount,
): {
  readonly routes: readonly RestCapability[];
  readonly unresolved: readonly UnresolvedDiagnostic[];
} {
  const parsed = parseJavaScript(legacyRoot, mount.file);
  const routes: RestCapability[] = [];
  const unresolved: UnresolvedDiagnostic[] = [];
  let declarationOrder = 0;

  visitAst(parsed, (node) => {
    if (!parsed.ts.isCallExpression(node)) return;
    const expression = node.expression.getText(parsed.sourceFile);
    const match = /^router\.(get|post|put|patch|delete)$/.exec(expression);
    if (match?.[1] === undefined) return;
    declarationOrder += 1;
    const method = ROUTE_METHODS.get(match[1]);
    const routePath = literalText(parsed, node.arguments[0]);
    if (method === undefined || routePath === undefined) {
      unresolved.push({
        category: 'route',
        source: { file: mount.file, line: sourceLine(parsed, node) },
        expression: node.getText(parsed.sourceFile),
        reason: 'route method or path cannot be resolved statically',
      });
      return;
    }

    const line = sourceLine(parsed, node);
    const effectivePath = composePath(mount.mountPath, routePath);
    const localMiddleware = node.arguments
      .slice(1, -1)
      .map((argument) =>
        argument.getText(parsed.sourceFile).replace(/\s+/g, ' ').trim(),
      );
    routes.push({
      id: `rest:${method}:${effectivePath}:${mount.file}:${line}`,
      kind: 'rest',
      source: { file: mount.file, line },
      owner: ownerForMount(mount.mountPath),
      risk: riskForMount(mount.mountPath),
      status: 'legacy',
      method,
      mountPath: mount.mountPath,
      routePath: normalizePath(routePath),
      effectivePath,
      middleware: [...mount.middleware, ...localMiddleware],
      declarationOrder,
      shadowed: false,
    });
  });

  return { routes, unresolved };
}

export function extractRestCapabilities(legacyRoot: string): RestExtraction {
  const routeFiles = listFiles(legacyRoot, 'routes', '.js');
  const routeImports = extractRouteImports(legacyRoot);
  const mountResult = resolveMounts(legacyRoot, routeImports);
  const mountedRouterModules = [
    ...new Set(mountResult.mounts.map(({ file }) => file)),
  ].sort();
  const routes: RestCapability[] = [];
  const unresolved = [...mountResult.unresolved];

  for (const mount of mountResult.mounts) {
    const extracted = extractRoutesForMount(legacyRoot, mount);
    routes.push(...extracted.routes);
    unresolved.push(...extracted.unresolved);
  }

  const duplicates: DuplicateRouteDiagnostic[] = [];
  const shadowedIds = new Set<string>();
  for (let laterIndex = 0; laterIndex < routes.length; laterIndex += 1) {
    const later = routes[laterIndex];
    if (later === undefined) continue;
    const earlier = routes
      .slice(0, laterIndex)
      .find(
        (candidate) =>
          candidate.method === later.method &&
          routePatternShadows(candidate.effectivePath, later.effectivePath),
      );
    if (earlier === undefined) continue;
    shadowedIds.add(later.id);
    duplicates.push({
      method: later.method,
      effectivePath: later.effectivePath,
      capabilityIds: [earlier.id, later.id],
    });
  }

  const markedRoutes = routes.map((route) =>
    shadowedIds.has(route.id) ? { ...route, shadowed: true } : route,
  );
  const inactive = routeFiles
    .filter((file) => !mountedRouterModules.includes(file))
    .map<InactiveCapability>((file) => ({
      id: `inactive:${file}`,
      kind: 'inactive',
      source: { file, line: 1 },
      owner: 'admin-support-jobs',
      risk: 'low',
      status: 'inactive',
      reason: 'route-module-not-mounted',
    }));

  return {
    routes: markedRoutes,
    inactive,
    mountedRouterModules,
    duplicates: duplicates.sort((left, right) =>
      `${left.method} ${left.effectivePath}`.localeCompare(
        `${right.method} ${right.effectivePath}`,
      ),
    ),
    unresolved,
  };
}
