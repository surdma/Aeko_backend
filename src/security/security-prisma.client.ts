import type { PrismaClient } from '../../prisma/generated/client';
import type { Prisma } from '../../prisma/generated/client';
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

export interface SocialTransaction {
  findUser(id: string): Promise<SocialUserRecord | null>;
  updateUser(id: string, data: Prisma.UserUpdateInput): Promise<void>;
  findUsers(
    ids: readonly string[],
    search: string,
  ): Promise<readonly SocialUserRecord[]>;
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
