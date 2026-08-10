import type { Prisma, PrismaClient } from '../../prisma/generated/client';
import { DomainError } from '../common/errors/domain.error';

export interface UserRecord {
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
  readonly privacy: unknown;
  readonly blockedUsers: unknown;
  readonly followers: unknown;
  readonly following: unknown;
}

interface FindManyRequest {
  readonly search: string;
  readonly skip: number;
  readonly take: number;
  readonly ids?: readonly string[];
}

export interface UserPrismaClient {
  findUnique(id: string): Promise<UserRecord | null>;
  findMany(request: FindManyRequest): Promise<readonly UserRecord[]>;
  count(search: string): Promise<number>;
  deleteInTransaction(id: string): Promise<void>;
  updatePicture(
    id: string,
    purpose: 'profile' | 'cover',
    url: string,
  ): Promise<string>;
}

const userSelection = {
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
  privacy: true,
  blockedUsers: true,
  followers: true,
  following: true,
} satisfies Prisma.UserSelect;

const searchWhere = (search: string): Prisma.UserWhereInput =>
  search.length > 0
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

export const createUserPrismaClient = (db: PrismaClient): UserPrismaClient => ({
  async findUnique(id) {
    return db.user.findUnique({ where: { id }, select: userSelection });
  },

  async findMany({ search, skip, take, ids }) {
    return db.user.findMany({
      where: ids ? { id: { in: [...ids] } } : searchWhere(search),
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: userSelection,
    });
  },

  async count(search) {
    return db.user.count({ where: searchWhere(search) });
  },

  async deleteInTransaction(id) {
    await db.$transaction(async (transaction) => {
      await transaction.user.delete({ where: { id } });
    });
  },

  async updatePicture(id, purpose, url) {
    const row =
      purpose === 'profile'
        ? await db.user.update({
            where: { id },
            data: { profilePicture: url },
            select: { profilePicture: true },
          })
        : await db.user.update({
            where: { id },
            data: { coverPicture: url },
            select: { coverPicture: true },
          });
    const storedUrl =
      'profilePicture' in row ? row.profilePicture : row.coverPicture;
    if (storedUrl !== url) {
      throw new DomainError(
        'INTERNAL_ERROR',
        'The user data service is unavailable.',
      );
    }
    return storedUrl;
  },
});
