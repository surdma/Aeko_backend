import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { extractJobCapabilities } from './extract-jobs';
import { extractPrismaCapabilities } from './extract-prisma';
import { extractRestCapabilities } from './extract-rest';
import { extractSocketCapabilities } from './extract-sockets';
import { parseJavaScript, sourceLine, visitAst } from './legacy-source';
import type {
  Capability,
  CapabilityInventory,
  Correction,
  ProviderCapability,
  SourceLocation,
  UnresolvedDiagnostic,
} from './inventory.types';

export const APPROVED_CORRECTION_IDS = [
  'correction:prisma-imports',
  'correction:database-readiness',
  'correction:blocking-privacy-order',
  'correction:security-headers',
  'correction:shadowed-post-routes',
  'correction:nonexistent-prisma-models',
  'correction:community-profile-ownership-drift',
  'correction:subscription-expiry-email',
  'correction:admin-cookie-secret',
  'correction:health-route-drift',
  'correction:environment-load-order',
  'correction:wallet-ownership-proof',
  'correction:post-chain-ownership',
  'correction:explorer-history-method',
  'correction:webhook-verification',
  'correction:raw-error-disclosure',
] as const;

interface CorrectionTemplate {
  readonly id: (typeof APPROVED_CORRECTION_IDS)[number];
  readonly category: Correction['category'];
  readonly evidenceFile: string;
  readonly evidenceText: string;
  readonly legacyBehavior: string;
  readonly replacementBehavior: string;
  readonly reason: string;
}

const CORRECTION_TEMPLATES: readonly CorrectionTemplate[] = [
  {
    id: 'correction:prisma-imports',
    category: 'runtime',
    evidenceFile: 'routes/webhookRoutes.js',
    evidenceText: "import prisma from '../config/db.js'",
    legacyBehavior:
      'Some webhook and community-profile paths use incompatible Prisma imports.',
    replacementBehavior:
      'All migrated handlers inject the single typed Prisma service.',
    reason: 'Incorrect import shapes fail deterministically at runtime.',
  },
  {
    id: 'correction:database-readiness',
    category: 'runtime',
    evidenceFile: 'config/db.js',
    evidenceText: 'Database connection failed:',
    legacyBehavior:
      'Database connection failure is logged and swallowed during startup.',
    replacementBehavior:
      'Readiness fails and bootstrap rejects when Prisma cannot connect.',
    reason:
      'A listening process must not claim readiness without its database.',
  },
  {
    id: 'correction:blocking-privacy-order',
    category: 'security',
    evidenceFile: 'server.js',
    evidenceText:
      'blockingMiddleware.checkPostInteraction(), privacyMiddleware.filterResponsePosts, postRoutes',
    legacyBehavior:
      'Blocking and privacy response middleware run before mounted route handlers.',
    replacementBehavior:
      'Nest guards and serializers enforce blocking/privacy at effective handler boundaries.',
    reason:
      'The legacy ordering can be ineffective or bypass expected response filtering.',
  },
  {
    id: 'correction:security-headers',
    category: 'security',
    evidenceFile: 'server.js',
    evidenceText: 'import helmet from "helmet"',
    legacyBehavior:
      'Helmet is imported but not installed as active middleware.',
    replacementBehavior:
      'Compatible Helmet security headers are installed globally.',
    reason:
      'The runtime should apply the security headers its dependency implies.',
  },
  {
    id: 'correction:shadowed-post-routes',
    category: 'correctness',
    evidenceFile: 'routes/postRoutes.js',
    evidenceText: 'router.',
    legacyBehavior:
      'Duplicate method/path declarations in post routing shadow later handlers.',
    replacementBehavior:
      'One reviewed Nest owner implements each effective post method/path contract.',
    reason: 'Declaration shadowing makes later code unreachable or ambiguous.',
  },
  {
    id: 'correction:nonexistent-prisma-models',
    category: 'runtime',
    evidenceFile: 'routes/communityProfileRoutes.js',
    evidenceText: "from '../controllers/communityProfileController.js'",
    legacyBehavior:
      'Some legacy handlers reference Prisma delegates absent from the schema.',
    replacementBehavior:
      'Handlers use only generated delegates or explicit compatible repositories.',
    reason:
      'A nonexistent model delegate causes deterministic runtime failure.',
  },
  {
    id: 'correction:community-profile-ownership-drift',
    category: 'security',
    evidenceFile: 'routes/communityProfileRoutes.js',
    evidenceText: 'Only community owner or moderators can update',
    legacyBehavior:
      'Community-profile documentation and runtime ownership checks do not consistently agree.',
    replacementBehavior:
      'Typed policies enforce the approved owner/moderator contract.',
    reason: 'Authorization behavior must match the public contract.',
  },
  {
    id: 'correction:subscription-expiry-email',
    category: 'runtime',
    evidenceFile: 'jobs/subscriptionExpirationNotifications.js',
    evidenceText:
      'sendExpirationNotification(user, community, member.subscription)',
    legacyBehavior:
      'Subscription expiry invokes an email path with a known incompatible service contract.',
    replacementBehavior:
      'The scheduled job calls the typed email provider with its supported contract.',
    reason:
      'The current invocation can fail instead of notifying expiring subscribers.',
  },
  {
    id: 'correction:admin-cookie-secret',
    category: 'security',
    evidenceFile: 'admin.js',
    evidenceText:
      "process.env.ADMINJS_COOKIE_SECRET || 'change-me-in-production'",
    legacyBehavior: 'AdminJS accepts a known fallback cookie secret.',
    replacementBehavior:
      'Startup rejects missing production admin session secrets.',
    reason: 'A public fallback secret permits session forgery.',
  },
  {
    id: 'correction:health-route-drift',
    category: 'correctness',
    evidenceFile: 'swagger.js',
    evidenceText: '"/health":',
    legacyBehavior:
      'Swagger documents a health route that the Express router does not mount.',
    replacementBehavior:
      'Nest exposes explicit liveness and readiness endpoints.',
    reason: 'Operational documentation must describe executable routes.',
  },
  {
    id: 'correction:environment-load-order',
    category: 'runtime',
    evidenceFile: 'server.js',
    evidenceText: 'dotenv.config();',
    legacyBehavior:
      'Jobs and chain configuration load before dotenv initialization.',
    replacementBehavior:
      'Validated configuration loads before providers and scheduled jobs.',
    reason:
      'Import-time provider configuration must not observe missing environment values.',
  },
  {
    id: 'correction:wallet-ownership-proof',
    category: 'security',
    evidenceFile: 'routes/walletRoutes.js',
    evidenceText: 'const { walletAddress } = req.body;',
    legacyBehavior:
      'A user can bind a supplied wallet address without proving control of it.',
    replacementBehavior:
      'Wallet binding requires nonce-based ownership proof tied to the authenticated user.',
    reason: 'Unproven address binding creates asset and identity risk.',
  },
  {
    id: 'correction:post-chain-ownership',
    category: 'security',
    evidenceFile: 'routes/postRoutes.js',
    evidenceText: 'owner:           creatorAddress',
    legacyBehavior:
      'Post anchoring and mint preparation do not consistently enforce post/signing ownership.',
    replacementBehavior:
      'Authenticated post ownership and signing-address binding are required.',
    reason:
      'Chain preparation must not authorize another user’s content or address.',
  },
  {
    id: 'correction:explorer-history-method',
    category: 'runtime',
    evidenceFile: 'routes/walletRoutes.js',
    evidenceText: 'explorer.getAccountDetail(address)',
    legacyBehavior:
      'Wallet history calls an explorer method that does not provide the documented history contract.',
    replacementBehavior:
      'The supported explorer history API is used through a typed adapter.',
    reason: 'The incompatible method call fails or returns the wrong shape.',
  },
  {
    id: 'correction:webhook-verification',
    category: 'security',
    evidenceFile: 'routes/webhookRoutes.js',
    evidenceText: "const signature = req.headers['x-paystack-signature'];",
    legacyBehavior:
      'Webhook verification lacks complete idempotency and replay protection.',
    replacementBehavior:
      'Raw-body signatures, event identity, idempotency, and replay windows are enforced.',
    reason:
      'Payment side effects must be authentic and exactly-once at the application boundary.',
  },
  {
    id: 'correction:raw-error-disclosure',
    category: 'security',
    evidenceFile: 'routes/postRoutes.js',
    evidenceText: 'res.status(500).json({ error: error.message });',
    legacyBehavior: 'Some handlers return raw internal exception messages.',
    replacementBehavior:
      'The global exception filter returns stable safe errors with correlation IDs.',
    reason: 'Internal errors can expose implementation and provider details.',
  },
];

function evidenceLocation(
  legacyRoot: string,
  file: string,
  evidenceText: string,
): SourceLocation | undefined {
  const absolute = join(resolve(legacyRoot), ...file.split('/'));
  if (!existsSync(absolute)) return undefined;
  const text = readFileSync(absolute, 'utf8');
  const index = text.indexOf(evidenceText);
  if (index < 0) return undefined;
  return { file, line: text.slice(0, index).split(/\r?\n/).length };
}

function seedCorrections(
  legacyRoot: string,
  capabilities: readonly Capability[],
): {
  readonly corrections: readonly Correction[];
  readonly unresolved: readonly UnresolvedDiagnostic[];
} {
  const corrections: Correction[] = [];
  const unresolved: UnresolvedDiagnostic[] = [];
  for (const template of CORRECTION_TEMPLATES) {
    const evidence = evidenceLocation(
      legacyRoot,
      template.evidenceFile,
      template.evidenceText,
    );
    if (evidence === undefined) {
      unresolved.push({
        category: 'correction',
        source: { file: template.evidenceFile, line: 1 },
        expression: template.evidenceText,
        reason: `approved correction evidence not found for ${template.id}`,
      });
      continue;
    }
    corrections.push({
      id: template.id,
      capabilityIds: capabilities
        .filter(({ source }) => source.file === template.evidenceFile)
        .map(({ id }) => id),
      category: template.category,
      legacyEvidence: [evidence],
      legacyBehavior: template.legacyBehavior,
      replacementBehavior: template.replacementBehavior,
      reason: template.reason,
      status: 'approved',
    });
  }
  return { corrections, unresolved };
}

const PROVIDER_PATTERNS = [
  { pattern: /(^|\/)stripe$|Stripe/, provider: 'stripe' },
  { pattern: /paymentService|PaymentService|paystack/i, provider: 'paystack' },
  { pattern: /emailService/i, provider: 'email' },
  { pattern: /cloudinary|middleware\/upload/, provider: 'cloudinary-media' },
  { pattern: /(^|\/)ai\/|openai/i, provider: 'ai' },
  { pattern: /ipfs/i, provider: 'ipfs' },
  { pattern: /(^|\/)chain\/|@aeko-chain/, provider: 'aeko-chain' },
  { pattern: /passport/, provider: 'google-oauth' },
  { pattern: /notificationService/, provider: 'push-notification' },
] as const;

function ownerForSource(file: string): string {
  if (/wallet|nft|marketplace|rewards|staking|postRoutes/.test(file))
    return 'chain';
  if (/payment|subscription|webhook|coin/i.test(file))
    return 'payments-subscriptions';
  if (/chat|Socket/.test(file)) return 'chat-realtime';
  if (/LiveStream/.test(file)) return 'livestream';
  if (/auth|user|profile|security/i.test(file)) return 'auth-users-security';
  return 'admin-support-jobs';
}

function extractProviderCapabilities(
  legacyRoot: string,
  files: readonly string[],
): readonly ProviderCapability[] {
  const providers: ProviderCapability[] = [];
  for (const file of [...new Set(files)].sort()) {
    const parsed = parseJavaScript(legacyRoot, file);
    visitAst(parsed, (node) => {
      const text = node.getText(parsed.sourceFile);
      if (!text.startsWith('import ')) return;
      const importMatch = /\sfrom\s+["']([^"']+)["'];?$/.exec(text);
      const importPath = importMatch?.[1];
      if (importPath === undefined) return;
      const provider = PROVIDER_PATTERNS.find(({ pattern }) =>
        pattern.test(importPath),
      );
      if (provider === undefined) return;
      const line = sourceLine(parsed, node);
      const digest = createHash('sha256')
        .update(`${file}:${line}:${provider.provider}:${importPath}`)
        .digest('hex')
        .slice(0, 12);
      providers.push({
        id: `provider:${provider.provider}:${digest}`,
        kind: 'provider',
        source: { file, line },
        owner: ownerForSource(file),
        risk:
          provider.provider === 'aeko-chain' || provider.provider === 'paystack'
            ? 'critical'
            : 'high',
        status: 'legacy',
        provider: provider.provider,
        importPath,
      });
    });
  }
  return providers;
}

const KIND_ORDER: Readonly<Record<Capability['kind'], number>> = {
  rest: 0,
  socket: 1,
  job: 2,
  model: 3,
  provider: 4,
  inactive: 5,
};

function capabilitySortKey(capability: Capability): string {
  const method = capability.kind === 'rest' ? capability.method : '';
  const path = capability.kind === 'rest' ? capability.effectivePath : '';
  return [
    String(KIND_ORDER[capability.kind]).padStart(2, '0'),
    capability.source.file,
    String(capability.source.line).padStart(8, '0'),
    method,
    path,
    capability.id,
  ].join('\u0000');
}

export function buildCapabilityInventory(
  legacyRoot: string,
): CapabilityInventory {
  const resolvedRoot = resolve(legacyRoot);
  const rest = extractRestCapabilities(resolvedRoot);
  const sockets = extractSocketCapabilities(resolvedRoot);
  const jobs = extractJobCapabilities(resolvedRoot);
  const models = extractPrismaCapabilities(resolvedRoot);
  const providers = extractProviderCapabilities(resolvedRoot, [
    'server.js',
    ...rest.mountedRouterModules,
    ...sockets.socketFiles,
    ...jobs.jobFiles,
  ]);
  const baseCapabilities: Capability[] = [
    ...rest.routes,
    ...sockets.capabilities,
    ...jobs.capabilities,
    ...models,
    ...providers,
    ...rest.inactive,
  ];
  const correctionResult = seedCorrections(resolvedRoot, baseCapabilities);
  return {
    schemaVersion: 1,
    sourceRoot: resolvedRoot.replace(/\\/g, '/'),
    sources: {
      server: 'server.js',
      prismaSchema: 'prisma/schema.prisma',
      mountedRouterModules: rest.mountedRouterModules,
      socketFiles: sockets.socketFiles,
      jobFiles: jobs.jobFiles,
    },
    capabilities: [...baseCapabilities].sort((left, right) =>
      capabilitySortKey(left).localeCompare(capabilitySortKey(right)),
    ),
    corrections: [...correctionResult.corrections].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    diagnostics: {
      unresolved: [
        ...rest.unresolved,
        ...sockets.unresolved,
        ...jobs.unresolved,
        ...correctionResult.unresolved,
      ].sort((left, right) =>
        `${left.source.file}:${left.source.line}:${left.category}`.localeCompare(
          `${right.source.file}:${right.source.line}:${right.category}`,
        ),
      ),
      duplicateRoutes: rest.duplicates,
    },
  };
}

export function serializeInventory(inventory: CapabilityInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function summarizeBy(
  inventory: CapabilityInventory,
  selector: (capability: Capability) => string,
): readonly [string, number][] {
  const counts = new Map<string, number>();
  inventory.capabilities.forEach((capability) => {
    const key = selector(capability);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

export function renderInventoryReport(inventory: CapabilityInventory): string {
  const lines = [
    '# Legacy capability inventory',
    '',
    `Source: \`${inventory.sourceRoot}\``,
    '',
    '## Exact counts',
    '',
    `- Mounted router modules: ${inventory.sources.mountedRouterModules.length}`,
    `- Capabilities: ${inventory.capabilities.length}`,
    ...summarizeBy(inventory, ({ kind }) => kind).map(
      ([kind, count]) => `- ${kind}: ${count}`,
    ),
    `- Approved corrections: ${inventory.corrections.length}`,
    `- Unresolved diagnostics: ${inventory.diagnostics.unresolved.length}`,
    `- Duplicate or shadowed REST pairs: ${inventory.diagnostics.duplicateRoutes.length}`,
    '',
    '## Owners',
    '',
    ...summarizeBy(inventory, ({ owner }) => owner).map(
      ([owner, count]) => `- ${owner}: ${count}`,
    ),
    '',
    '## Risk',
    '',
    ...summarizeBy(inventory, ({ risk }) => risk).map(
      ([risk, count]) => `- ${risk}: ${count}`,
    ),
    '',
    '## Unresolved items',
    '',
    ...(inventory.diagnostics.unresolved.length === 0
      ? ['None.']
      : inventory.diagnostics.unresolved.map(
          ({ category, source, expression, reason }) =>
            `- ${category} at \`${source.file}:${source.line}\`: ${reason}; \`${expression.replace(/\s+/g, ' ')}\``,
        )),
    '',
    '## Duplicate and shadowed routes',
    '',
    ...(inventory.diagnostics.duplicateRoutes.length === 0
      ? ['None.']
      : inventory.diagnostics.duplicateRoutes.map(
          ({ method, effectivePath, capabilityIds }) =>
            `- \`${method} ${effectivePath}\`: ${capabilityIds.join(', ')}`,
        )),
    '',
    '## Inactive items',
    '',
    ...inventory.capabilities
      .filter(({ kind }) => kind === 'inactive')
      .map(({ id, source }) => `- \`${id}\` from \`${source.file}\``),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function writeArtifact(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents, 'utf8');
}

export function writeInventoryArtifacts(
  inventory: CapabilityInventory,
  workspaceRoot = process.cwd(),
): void {
  const docsRoot = join(workspaceRoot, 'docs', 'nestjs-migration');
  writeArtifact(
    join(docsRoot, 'capability-inventory.json'),
    serializeInventory(inventory),
  );
  writeArtifact(
    join(docsRoot, 'corrections.json'),
    `${JSON.stringify(inventory.corrections, null, 2)}\n`,
  );
  writeArtifact(
    join(docsRoot, 'inventory-report.md'),
    renderInventoryReport(inventory),
  );
}

function legacyRootArgument(argv: readonly string[]): string {
  const index = argv.indexOf('--legacy-root');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined || value.trim() === '') {
    throw new Error(
      'Usage: build-inventory.ts --legacy-root <legacy-express-root>',
    );
  }
  return value;
}

if (require.main === module) {
  const inventory = buildCapabilityInventory(
    legacyRootArgument(process.argv.slice(2)),
  );
  writeInventoryArtifacts(inventory);
  process.stdout.write(
    `Inventory generated: ${inventory.capabilities.length} capabilities, ` +
      `${inventory.diagnostics.unresolved.length} unresolved.\n`,
  );
  if (inventory.diagnostics.unresolved.length > 0) process.exitCode = 1;
}
