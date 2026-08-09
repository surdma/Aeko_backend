import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APPROVED_CORRECTION_IDS,
  buildCapabilityInventory,
  serializeInventory,
} from '../../scripts/inventory/build-inventory';
import type {
  CapabilityInventory,
  RestCapability,
} from '../../scripts/inventory/inventory.types';

const LEGACY_ROOT = 'C:\\Users\\olaitan\\Dev\\aeko\\backend';

const MOUNTED_ROUTER_FILES = [
  'routes/adRoutes.js',
  'routes/adminRoutes.js',
  'routes/auth.js',
  'routes/bot.js',
  'routes/challenges.js',
  'routes/chat.js',
  'routes/coinRoutes.js',
  'routes/commentRoutes.js',
  'routes/communityPaymentRoutes.js',
  'routes/communityProfileRoutes.js',
  'routes/communityRoutes.js',
  'routes/debates.js',
  'routes/enhancedBotRoutes.js',
  'routes/enhancedChatRoutes.js',
  'routes/enhancedLiveStreamRoutes.js',
  'routes/explore.js',
  'routes/interestRoutes.js',
  'routes/marketplaceRoutes.js',
  'routes/nftRoutes.js',
  'routes/notificationRoutes.js',
  'routes/paymentRoutes.js',
  'routes/photoEdit.js',
  'routes/postRoutes.js',
  'routes/profile.js',
  'routes/reportRoutes.js',
  'routes/rewardsRoutes.js',
  'routes/security.js',
  'routes/space.js',
  'routes/stakingRoutes.js',
  'routes/status.js',
  'routes/subscriptionPlanRoutes.js',
  'routes/subscriptionRoutes.js',
  'routes/supportRoutes.js',
  'routes/userInterestRoutes.js',
  'routes/userRoutes.js',
  'routes/videoEdit.js',
  'routes/waitlistRoutes.js',
  'routes/walletRoutes.js',
  'routes/webhookRoutes.js',
] as const;

const INACTIVE_ROUTE_FILES = [
  'routes/adminAuth.js',
  'routes/postTransferRoutes.js',
] as const;

describe('legacy capability inventory', () => {
  let inventory: CapabilityInventory;

  beforeAll(() => {
    inventory = buildCapabilityInventory(LEGACY_ROOT);
  });

  it('resolves all 39 mounted router modules and no mounted capability is unresolved', () => {
    expect(inventory.sources.mountedRouterModules).toEqual(
      MOUNTED_ROUTER_FILES,
    );
    expect(inventory.diagnostics.unresolved).toEqual([]);
  });

  it('records normalized effective REST handlers without dropping shadowed declarations', () => {
    const routes = inventory.capabilities.filter(
      (capability): capability is RestCapability => capability.kind === 'rest',
    );

    expect(routes.length).toBeGreaterThan(0);
    expect(
      routes.every(
        ({ method, effectivePath }) =>
          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
          effectivePath.startsWith('/') &&
          !effectivePath.includes('//'),
      ),
    ).toBe(true);
    expect(inventory.diagnostics.duplicateRoutes.length).toBeGreaterThan(0);
    expect(
      inventory.diagnostics.duplicateRoutes.every(({ capabilityIds }) =>
        capabilityIds.every((id) => routes.some((route) => route.id === id)),
      ),
    ).toBe(true);
  });

  it('records both Socket.IO namespaces and all literal inbound and outbound events', () => {
    const sockets = inventory.capabilities.filter(
      (capability) => capability.kind === 'socket',
    );

    expect(
      [...new Set(sockets.map(({ namespace }) => namespace))].sort(),
    ).toEqual(['/', '/livestream']);
    expect(sockets.some(({ direction }) => direction === 'inbound')).toBe(true);
    expect(sockets.some(({ direction }) => direction === 'outbound')).toBe(
      true,
    );
    expect(sockets.every(({ event }) => event.length > 0)).toBe(true);
  });

  it('records every scheduled job and cron expression', () => {
    const jobs = inventory.capabilities.filter(
      (capability) => capability.kind === 'job',
    );

    expect(
      jobs.map(({ source, schedule }) => `${source.file}:${schedule}`).sort(),
    ).toEqual([
      'jobs/expireSubscriptions.js:0 0 * * *',
      'jobs/expireSubscriptions.js:0 9 * * *',
      'jobs/settleEpoch.js:0 0 * * *',
    ]);
    expect(jobs.every(({ schedule }) => schedule.length > 0)).toBe(true);
  });

  it('records every Prisma model and enum', () => {
    const schema = readFileSync(
      join(LEGACY_ROOT, 'prisma/schema.prisma'),
      'utf8',
    );
    const declarations = [
      ...schema.matchAll(/^\s*(model|enum)\s+(\w+)\s*\{/gm),
    ].map(([, declarationKind, name]) => `${declarationKind}:${name}`);
    const inventoryDeclarations = inventory.capabilities
      .filter((capability) => capability.kind === 'model')
      .map(({ declarationKind, name }) => `${declarationKind}:${name}`);

    expect(inventoryDeclarations.sort()).toEqual(declarations.sort());
  });

  it('classifies every unmounted route file as inactive', () => {
    const inactiveFiles = inventory.capabilities
      .filter((capability) => capability.kind === 'inactive')
      .map(({ source }) => source.file)
      .sort();

    expect(inactiveFiles).toEqual(INACTIVE_ROUTE_FILES);
  });

  it('assigns one owner, stable unique IDs, and correct initial statuses', () => {
    const ids = inventory.capabilities.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      inventory.capabilities.every(({ owner }) => owner.trim().length > 0),
    ).toBe(true);
    expect(
      inventory.capabilities.every(({ kind, status }) =>
        kind === 'inactive' ? status === 'inactive' : status === 'legacy',
      ),
    ).toBe(true);
    expect(serializeInventory(buildCapabilityInventory(LEGACY_ROOT))).toBe(
      serializeInventory(inventory),
    );
  });

  it('seeds every approved migration correction', () => {
    expect(inventory.corrections.map(({ id }) => id).sort()).toEqual(
      [...APPROVED_CORRECTION_IDS].sort(),
    );
    expect(
      inventory.corrections.every(({ status }) => status === 'approved'),
    ).toBe(true);
  });
});
