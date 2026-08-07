import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  AuthMigrationStatus,
  type Prisma,
  PrismaClient,
  type User,
} from '@prisma/client';

export type MigrationMode = 'dry-run' | 'apply';

export interface MigrationSummary {
  scanned: number;
  migrated: number;
  alreadyMigrated: number;
  conflicts: number;
  failed: number;
}

interface LegacyVerification {
  readonly isVerified: boolean;
}

interface LegacyTwoFactor {
  readonly isEnabled: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verification(value: Prisma.JsonValue | null): LegacyVerification {
  return {
    isVerified: isRecord(value) && value.isVerified === true,
  };
}

function twoFactor(value: Prisma.JsonValue | null): LegacyTwoFactor {
  return {
    isEnabled: isRecord(value) && value.isEnabled === true,
  };
}

function profileCompletion(value: Prisma.JsonValue | null): Prisma.InputJsonValue {
  return isRecord(value) ? { ...value } : {};
}

function normalizedProvider(value: string | null): string | null {
  const provider = value?.trim().toLowerCase();
  return provider === 'google' ? 'google' : null;
}

async function alreadyMigrated(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const link = await prisma.authMigrationLink.findUnique({
    where: { legacyUserId: userId },
    select: { authUserId: true, status: true },
  });
  return (
    link?.authUserId === userId && link.status === AuthMigrationStatus.MIGRATED
  );
}

function conflictDetails(
  user: User,
  existing: Readonly<{ id: string; email: string; username: string | null }>,
): Prisma.InputJsonValue {
  return {
    reason: 'canonical-identity-conflict',
    legacy: { id: user.id, email: user.email, username: user.username },
    canonical: {
      id: existing.id,
      email: existing.email,
      username: existing.username,
    },
  };
}

async function recordConflict(
  prisma: PrismaClient,
  user: User,
  existing: Readonly<{ id: string; email: string; username: string | null }>,
): Promise<void> {
  const linked = await prisma.authMigrationLink.findUnique({
    where: { authUserId: existing.id },
    select: { legacyUserId: true },
  });
  if (linked !== null && linked.legacyUserId !== user.id) return;

  await prisma.authMigrationLink.upsert({
    where: { legacyUserId: user.id },
    create: {
      legacyUserId: user.id,
      authUserId: existing.id,
      status: AuthMigrationStatus.CONFLICT,
      details: conflictDetails(user, existing),
    },
    update: {
      authUserId: existing.id,
      status: AuthMigrationStatus.CONFLICT,
      details: conflictDetails(user, existing),
      migratedAt: null,
    },
  });
}

async function ensureAccounts(
  transaction: Prisma.TransactionClient,
  user: User,
): Promise<void> {
  const credential = await transaction.authAccount.findFirst({
    where: {
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
    },
    select: { id: true },
  });
  if (credential === null) {
    await transaction.authAccount.create({
      data: {
        id: randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: user.password,
      },
    });
  }

  const providerId = normalizedProvider(user.oauthProvider);
  const providerAccountId = user.oauthId?.trim();
  if (
    providerId === null ||
    providerAccountId === undefined ||
    providerAccountId.length === 0
  ) {
    return;
  }

  const provider = await transaction.authAccount.findFirst({
    where: { userId: user.id, providerId, accountId: providerAccountId },
    select: { id: true },
  });
  if (provider === null) {
    await transaction.authAccount.create({
      data: {
        id: randomUUID(),
        accountId: providerAccountId,
        providerId,
        userId: user.id,
      },
    });
  }
}

async function applyUser(
  prisma: PrismaClient,
  user: User,
): Promise<'migrated' | 'existing' | 'conflict'> {
  if (await alreadyMigrated(prisma, user.id)) return 'existing';

  const existing = await prisma.authUser.findFirst({
    where: {
      OR: [{ id: user.id }, { email: user.email }, { username: user.username }],
    },
    select: { id: true, email: true, username: true },
  });

  if (existing !== null && existing.id !== user.id) {
    await recordConflict(prisma, user, existing);
    return 'conflict';
  }

  const wasExisting = existing !== null;
  const verified = verification(user.emailVerification);
  const factor = twoFactor(user.twoFactorAuth);

  await prisma.$transaction(async (transaction) => {
    await transaction.authUser.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: verified.isVerified,
        image: user.profilePicture ?? user.avatar,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        username: user.username,
        displayUsername: user.username,
        twoFactorEnabled: factor.isEnabled,
      },
      update: {
        name: user.name,
        emailVerified: verified.isVerified,
        image: user.profilePicture ?? user.avatar,
        username: user.username,
        displayUsername: user.username,
        twoFactorEnabled: factor.isEnabled,
      },
    });

    await transaction.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        bio: user.bio,
        profilePicture: user.profilePicture ?? user.avatar,
        coverPhoto: user.coverPicture,
        location: user.location,
        blueTick: user.blueTick,
        profileCompletion: profileCompletion(user.profileCompletion),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      update: {
        bio: user.bio,
        profilePicture: user.profilePicture ?? user.avatar,
        coverPhoto: user.coverPicture,
        location: user.location,
        blueTick: user.blueTick,
        profileCompletion: profileCompletion(user.profileCompletion),
      },
    });

    await ensureAccounts(transaction, user);
    await transaction.authMigrationLink.upsert({
      where: { legacyUserId: user.id },
      create: {
        legacyUserId: user.id,
        authUserId: user.id,
        status: AuthMigrationStatus.MIGRATED,
        migratedAt: new Date(),
        details: {
          source: 'v0-users',
          credentialHashPreserved: true,
          googleAccountImported:
            normalizedProvider(user.oauthProvider) === 'google' &&
            typeof user.oauthId === 'string' &&
            user.oauthId.trim().length > 0,
        },
      },
      update: {
        authUserId: user.id,
        status: AuthMigrationStatus.MIGRATED,
        migratedAt: new Date(),
        details: {
          source: 'v0-users',
          credentialHashPreserved: true,
          googleAccountImported:
            normalizedProvider(user.oauthProvider) === 'google' &&
            typeof user.oauthId === 'string' &&
            user.oauthId.trim().length > 0,
        },
      },
    });
  });

  return wasExisting ? 'existing' : 'migrated';
}

export async function migrateV0Users(
  prisma: PrismaClient,
  mode: MigrationMode,
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    scanned: 0,
    migrated: 0,
    alreadyMigrated: 0,
    conflicts: 0,
    failed: 0,
  };
  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.user.findMany({
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    if (batch.length === 0) break;

    for (const user of batch) {
      summary.scanned += 1;
      try {
        if (await alreadyMigrated(prisma, user.id)) {
          summary.alreadyMigrated += 1;
          continue;
        }

        const existing = await prisma.authUser.findFirst({
          where: {
            OR: [
              { id: user.id },
              { email: user.email },
              { username: user.username },
            ],
          },
          select: { id: true, email: true, username: true },
        });
        if (existing !== null && existing.id !== user.id) {
          summary.conflicts += 1;
          if (mode === 'apply') await recordConflict(prisma, user, existing);
          continue;
        }
        if (mode === 'dry-run') {
          if (existing === null) summary.migrated += 1;
          else summary.alreadyMigrated += 1;
          continue;
        }

        const result = await applyUser(prisma, user);
        if (result === 'migrated') summary.migrated += 1;
        else if (result === 'existing') summary.alreadyMigrated += 1;
        else summary.conflicts += 1;
      } catch (error: unknown) {
        summary.failed += 1;
        process.stderr.write(
          `${JSON.stringify({
            event: 'v0-auth-migration-failed',
            userId: user.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })}\n`,
        );
      }
    }

    cursor = batch.at(-1)?.id;
  }

  return summary;
}

function modeFromArguments(arguments_: readonly string[]): MigrationMode {
  if (arguments_.includes('--apply')) return 'apply';
  if (arguments_.includes('--dry-run') || arguments_.length === 0) {
    return 'dry-run';
  }
  throw new Error('Use --dry-run or --apply');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  try {
    const mode = modeFromArguments(process.argv.slice(2));
    const summary = await migrateV0Users(prisma, mode);
    process.stdout.write(`${JSON.stringify({ mode, ...summary })}\n`);
    if (summary.failed > 0 || summary.conflicts > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
