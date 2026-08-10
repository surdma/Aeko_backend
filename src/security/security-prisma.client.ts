import type { PrismaClient } from '../generated/prisma/client';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaTransaction } from '../database/prisma/prisma.service';

export interface SocialUserRecord {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly image: string | null;
  readonly avatar: string | null;
  readonly profilePicture: string | null;
  readonly coverPicture: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
  readonly createdAt: Date;
  readonly blockedUsers: unknown;
  readonly privacy: unknown;
  readonly followRequests: unknown;
  readonly followers: unknown;
  readonly following: unknown;
}

export type FollowState = 'accepted' | 'requested';

export interface SocialTransaction {
  findUser(id: string): Promise<SocialUserRecord | null>;
  updateUser(id: string, data: Prisma.UserUpdateInput): Promise<void>;
  findUsers(
    ids: readonly string[],
    search: string,
  ): Promise<readonly SocialUserRecord[]>;

  /**
   * Relational half of the dual-write. These run inside the same transaction
   * as the JSON column updates above, so the two representations cannot drift
   * apart within a single request.
   *
   * The JSON columns stay authoritative for reads until the legacy Express
   * service stops writing them; nothing reads these tables yet.
   */
  setFollow(
    followerId: string,
    followeeId: string,
    state: FollowState,
  ): Promise<void>;
  removeFollow(followerId: string, followeeId: string): Promise<void>;
  setBlock(
    blockerId: string,
    blockedId: string,
    reason: string | null,
  ): Promise<void>;
  removeBlock(blockerId: string, blockedId: string): Promise<void>;
}

export interface SocialPrismaClient extends SocialTransaction {
  transaction(
    operation: (transaction: SocialTransaction) => Promise<unknown>,
  ): Promise<unknown>;
}

const selection = {
  id: true,
  username: true,
  name: true,
  image: true,
  avatar: true,
  profilePicture: true,
  coverPicture: true,
  bio: true,
  location: true,
  blueTick: true,
  goldenTick: true,
  createdAt: true,
  blockedUsers: true,
  privacy: true,
  followRequests: true,
  followers: true,
  following: true,
} satisfies Prisma.UserSelect;

const createTransaction = (db: PrismaTransaction): SocialTransaction => ({
  async findUser(id) {
    return db.user.findUnique({ where: { id }, select: selection });
  },
  async updateUser(id, data) {
    await db.user.update({ where: { id }, data });
  },
  async findUsers(ids, search) {
    if (ids.length === 0) return [];
    const where: Prisma.UserWhereInput = {
      id: { in: [...ids] },
      ...(search === ''
        ? {}
        : { username: { contains: search, mode: 'insensitive' } }),
    };
    return db.user.findMany({ where, select: selection });
  },

  async setFollow(followerId, followeeId, state) {
    if (followerId === followeeId) return;
    await db.follow.upsert({
      where: { followerId_followeeId: { followerId, followeeId } },
      create: { followerId, followeeId, state },
      update: { state },
    });
  },
  async removeFollow(followerId, followeeId) {
    await db.follow.deleteMany({ where: { followerId, followeeId } });
  },
  async setBlock(blockerId, blockedId, reason) {
    if (blockerId === blockedId) return;
    await db.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId, reason },
      update: { reason },
    });
  },
  async removeBlock(blockerId, blockedId) {
    await db.block.deleteMany({ where: { blockerId, blockedId } });
  },
});

export const createSocialPrismaClient = (
  db: PrismaClient,
): SocialPrismaClient => ({
  ...createTransaction(db),
  async transaction(operation) {
    return db.$transaction(
      async (transaction) => operation(createTransaction(transaction)),
      { isolationLevel: 'Serializable' },
    );
  },
});
