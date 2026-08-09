import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type CapabilityKind =
  'rest' | 'socket' | 'job' | 'model' | 'provider' | 'inactive';
type Risk = 'low' | 'medium' | 'high' | 'critical';
type SpecialistReview =
  'backend' | 'security' | 'payments' | 'blockchain' | 'realtime';

interface Capability {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly owner: string;
  readonly risk: Risk;
  readonly status: 'legacy' | 'inactive';
  readonly effectivePath?: string;
  readonly provider?: string;
}

interface Correction {
  readonly id: string;
  readonly capabilityIds: readonly string[];
  readonly category: string;
  readonly status: 'approved';
}

interface CapabilityInventory {
  readonly capabilities: readonly Capability[];
}

interface DomainManifest {
  readonly id: string;
  readonly order: number;
  readonly capabilityIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly nestModules: readonly string[];
  readonly providerPorts: readonly string[];
  readonly corrections: readonly string[];
  readonly cutoverUnit: readonly string[];
  readonly risk: Risk;
  readonly specialistReview: readonly SpecialistReview[];
}

const ROOT = join(__dirname, '..', '..');
const DOMAINS_ROOT = join(ROOT, 'docs', 'nestjs-migration', 'domains');

const DOMAIN_IDS = [
  'auth-users-security',
  'content-social',
  'debates-challenges-spaces',
  'communities',
  'chat-realtime',
  'livestream',
  'ads-media',
  'payments-subscriptions',
  'chain',
  'admin-support-jobs',
] as const;

// Vocabulary is taken from the approved design's bounded feature capabilities.
const KNOWN_NEST_MODULES = new Set([
  'auth',
  'users',
  'profiles',
  'security',
  'posts',
  'comments',
  'status',
  'explore',
  'notifications',
  'reports',
  'debates',
  'challenges',
  'spaces',
  'interests',
  'communities',
  'community-profiles',
  'community-payments',
  'chat',
  'enhanced-chat',
  'bot',
  'enhanced-bot',
  'video-calls',
  'root-realtime',
  'livestream',
  'ads',
  'photo-editing',
  'video-editing',
  // The approved ads-media plan serves both editing routes from one module.
  'media-processing',
  'uploads',
  'media',
  'ipfs',
  'payments',
  'subscription-plans',
  'subscriptions',
  'webhooks',
  'coins',
  'wallets',
  'nfts',
  'marketplace',
  'rewards',
  'staking',
  'post-chain-operations',
  'admin-api',
  'support',
  'waitlist',
  'exports',
  'jobs',
  'health',
  'api-documentation',
]);

const RISK_ORDER: Record<Risk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const inventory = JSON.parse(
  readFileSync(
    join(ROOT, 'docs', 'nestjs-migration', 'capability-inventory.json'),
    'utf8',
  ),
) as CapabilityInventory;
const corrections = JSON.parse(
  readFileSync(
    join(ROOT, 'docs', 'nestjs-migration', 'corrections.json'),
    'utf8',
  ),
) as readonly Correction[];

function readManifests(): readonly DomainManifest[] {
  return DOMAIN_IDS.map((id) => {
    const raw = readFileSync(join(DOMAINS_ROOT, `${id}.json`), 'utf8');
    const manifest = JSON.parse(raw) as DomainManifest;
    expect(raw).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(manifest.id).toBe(id);
    return manifest;
  });
}

function ownersByCapability(
  manifests: readonly DomainManifest[],
): ReadonlyMap<string, readonly DomainManifest[]> {
  const ownership = new Map<string, DomainManifest[]>();
  for (const manifest of manifests) {
    for (const capabilityId of manifest.capabilityIds) {
      const owners = ownership.get(capabilityId) ?? [];
      owners.push(manifest);
      ownership.set(capabilityId, owners);
    }
  }
  return ownership;
}

describe('NestJS migration programme', () => {
  let manifests: readonly DomainManifest[];

  beforeAll(() => {
    manifests = readManifests();
  });

  it('publishes exactly ten deterministic manifests with valid schema values', () => {
    expect(manifests).toHaveLength(10);
    expect(new Set(manifests.map(({ id }) => id))).toEqual(new Set(DOMAIN_IDS));
    expect(new Set(manifests.map(({ order }) => order))).toEqual(
      new Set(Array.from({ length: 10 }, (_, index) => index + 1)),
    );

    for (const manifest of manifests) {
      expect(manifest.capabilityIds).toEqual(
        [...manifest.capabilityIds].sort(),
      );
      expect(manifest.providerPorts).toEqual(
        [...manifest.providerPorts].sort(),
      );
      expect(manifest.corrections).toEqual([...manifest.corrections].sort());
      expect(manifest.capabilityIds.length).toBeGreaterThan(0);
      expect(manifest.nestModules.length).toBeGreaterThan(0);
      expect(manifest.specialistReview).toContain('backend');
      expect(Object.hasOwn(RISK_ORDER, manifest.risk)).toBe(true);
    }
  });

  it('owns every active capability exactly once and no inactive capability', () => {
    const ownership = ownersByCapability(manifests);
    const active = inventory.capabilities.filter(
      ({ status }) => status !== 'inactive',
    );
    const inactive = inventory.capabilities.filter(
      ({ status }) => status === 'inactive',
    );

    expect(
      active.filter(({ id }) => (ownership.get(id) ?? []).length !== 1),
    ).toEqual([]);
    expect(
      inactive.filter(({ id }) => ownership.has(id)).map(({ id }) => id),
    ).toEqual([]);
    expect(
      [...ownership.keys()].filter(
        (id) =>
          !inventory.capabilities.some((capability) => capability.id === id),
      ),
    ).toEqual([]);

    const authOwner = manifests.find(({ id }) => id === 'auth-users-security');
    const legacyAuthIds = active
      .filter(({ effectivePath }) => effectivePath?.startsWith('/api/auth/'))
      .map(({ id }) => id);
    expect(authOwner).toBeDefined();
    expect(
      legacyAuthIds.filter(
        (capabilityId) => !authOwner?.capabilityIds.includes(capabilityId),
      ),
    ).toEqual([]);
    expect(authOwner?.corrections).toContain(
      'correction:native-better-auth-cutover',
    );
  });

  it('orders every declared dependency before its consumer', () => {
    const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
    for (const manifest of manifests) {
      for (const dependencyId of manifest.dependsOn) {
        const dependency = byId.get(dependencyId);
        expect(dependency).toBeDefined();
        expect(dependency?.order).toBeLessThan(manifest.order);
      }
    }
  });

  it('uses only approved bounded-capability Nest modules', () => {
    const unknown = manifests.flatMap(({ id, nestModules }) =>
      nestModules
        .filter((moduleId) => !KNOWN_NEST_MODULES.has(moduleId))
        .map((moduleId) => `${id}:${moduleId}`),
    );
    expect(unknown).toEqual([]);
  });

  it('declares every owned provider capability as a typed provider port', () => {
    const byId = new Map(
      inventory.capabilities.map((capability) => [capability.id, capability]),
    );
    const knownProviders = new Set(
      inventory.capabilities
        .map(({ provider }) => provider)
        .filter((provider): provider is string => provider !== undefined),
    );

    for (const manifest of manifests) {
      const requiredProviders = manifest.capabilityIds
        .map((id) => byId.get(id)?.provider)
        .filter((provider): provider is string => provider !== undefined);
      expect(
        requiredProviders.filter(
          (provider) => !manifest.providerPorts.includes(provider),
        ),
      ).toEqual([]);
      expect(
        manifest.providerPorts.filter(
          (provider) => !knownProviders.has(provider),
        ),
      ).toEqual([]);
    }
  });

  it('keeps each capability in its single-owner atomic cutover unit', () => {
    for (const manifest of manifests) {
      expect(manifest.cutoverUnit).toEqual(manifest.capabilityIds);
      expect(new Set(manifest.cutoverUnit).size).toBe(
        manifest.cutoverUnit.length,
      );
    }
  });

  it('assigns every approved correction to exactly one owning domain', () => {
    const ownership = ownersByCapability(manifests);
    const correctionOwners = new Map<string, DomainManifest[]>();
    for (const manifest of manifests) {
      for (const correctionId of manifest.corrections) {
        const owners = correctionOwners.get(correctionId) ?? [];
        owners.push(manifest);
        correctionOwners.set(correctionId, owners);
      }
    }

    expect(
      corrections.filter(
        ({ id }) => (correctionOwners.get(id) ?? []).length !== 1,
      ),
    ).toEqual([]);
    expect(
      [...correctionOwners.keys()].filter(
        (id) => !corrections.some((correction) => correction.id === id),
      ),
    ).toEqual([]);

    for (const correction of corrections) {
      const correctionOwner = correctionOwners.get(correction.id)?.[0];
      expect(correctionOwner).toBeDefined();
      expect(
        correction.capabilityIds.filter(
          (capabilityId) => !ownership.has(capabilityId),
        ),
      ).toEqual([]);
      if (correction.capabilityIds.length > 0) {
        expect(
          correction.capabilityIds.some(
            (capabilityId) =>
              ownership.get(capabilityId)?.[0] === correctionOwner,
          ),
        ).toBe(true);
      }
    }
  });

  it('sets each domain risk to its highest owned capability risk', () => {
    const byId = new Map(
      inventory.capabilities.map((capability) => [capability.id, capability]),
    );
    for (const manifest of manifests) {
      const expected = manifest.capabilityIds
        .map((id) => byId.get(id)?.risk)
        .filter((risk): risk is Risk => risk !== undefined)
        .reduce(
          (highest, risk) =>
            RISK_ORDER[risk] > RISK_ORDER[highest] ? risk : highest,
          'low',
        );
      expect(manifest.risk).toBe(expected);
    }
  });

  it('requires payments, blockchain, realtime, and security specialists', () => {
    const byId = new Map(
      inventory.capabilities.map((capability) => [capability.id, capability]),
    );
    for (const manifest of manifests) {
      const owned = manifest.capabilityIds
        .map((id) => byId.get(id))
        .filter(
          (capability): capability is Capability => capability !== undefined,
        );
      const paths = owned.map(({ effectivePath }) => effectivePath ?? '');

      if (
        owned.some(({ owner }) => owner === 'payments-subscriptions') ||
        paths.some((path) => /payment|subscription|webhook|coin/i.test(path))
      ) {
        expect(manifest.specialistReview).toContain('payments');
      }
      if (owned.some(({ owner }) => owner === 'chain')) {
        expect(manifest.specialistReview).toContain('blockchain');
      }
      if (owned.some(({ kind }) => kind === 'socket')) {
        expect(manifest.specialistReview).toContain('realtime');
      }
      if (
        owned.some(({ owner }) => owner === 'auth-users-security') ||
        paths.some((path) => /webhook/i.test(path))
      ) {
        expect(manifest.specialistReview).toContain('security');
      }
      if (
        manifest.corrections.some((correctionId) =>
          corrections.some(
            (correction) =>
              correction.id === correctionId &&
              correction.category === 'security',
          ),
        )
      ) {
        expect(manifest.specialistReview).toContain('security');
      }
    }
  });
});
