import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toJsonValue, type JsonValue } from '../common/json/json-value';

export type WritableJson = Exclude<JsonValue, null>;

export interface OwnerRecord {
  readonly name: string;
  readonly username: string;
  readonly profilePicture: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
}

export interface MemberSummary {
  readonly name: string;
  readonly username: string;
  readonly profilePicture: string | null;
}

export interface CommunityRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly ownerId: string | null;
  readonly owner: OwnerRecord | null;
  readonly isPrivate: boolean;
  readonly isActive: boolean;
  readonly memberCount: number;
  readonly tags: readonly string[];
  readonly profile: JsonValue;
  readonly settings: JsonValue;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MembershipRecord {
  readonly communityId: string;
  readonly userId: string;
  readonly role: string;
  readonly status: string;
}

export interface CommunityWriteData {
  readonly name?: string;
  readonly description?: string;
  readonly isPrivate?: boolean;
  readonly tags?: readonly string[];
  readonly settings?: WritableJson;
  readonly profile?: WritableJson;
  readonly isActive?: boolean;
}

export interface CommunityTransactionClient {
  findById(id: string): Promise<CommunityRecord | null>;
  findMembership(
    communityId: string,
    userId: string,
  ): Promise<MembershipRecord | null>;
  update(id: string, data: CommunityWriteData): Promise<CommunityRecord>;
  /**
   * Creates the membership and reports whether it was new. The unique
   * constraint on (communityId, userId) is the gate, so a racing double join
   * cannot produce two rows or two increments.
   */
  addMember(
    communityId: string,
    userId: string,
    role: string,
    status: string,
  ): Promise<boolean>;
  removeMember(communityId: string, userId: string): Promise<boolean>;
  adjustMemberCount(communityId: string, delta: number): Promise<void>;
  setMemberCount(communityId: string, value: number): Promise<void>;
  findChatId(communityId: string): Promise<string | null>;
  addChatMember(chatId: string, userId: string): Promise<void>;
  removeChatMember(chatId: string, userId: string): Promise<void>;
  clearMembers(communityId: string): Promise<void>;
  clearChatMembers(chatId: string): Promise<void>;
}

export const SERIALIZABLE_ATTEMPTS = 3;

export interface CommunityPrismaClient {
  findById(id: string): Promise<CommunityRecord | null>;
  findByName(name: string): Promise<CommunityRecord | null>;
  findMembership(
    communityId: string,
    userId: string,
  ): Promise<MembershipRecord | null>;
  findMembersPreview(
    communityId: string,
    take: number,
  ): Promise<readonly MemberSummary[]>;
  findModerators(communityId: string): Promise<readonly MemberSummary[]>;
  list(
    search: string | null,
    skip: number,
    take: number,
  ): Promise<readonly CommunityRecord[]>;
  count(search: string | null): Promise<number>;
  listMine(
    userId: string,
    search: string | null,
    skip: number,
    take: number,
  ): Promise<readonly CommunityRecord[]>;
  countMine(userId: string, search: string | null): Promise<number>;
  hasGoldenTick(userId: string): Promise<boolean | null>;
  createWithOwner(
    ownerId: string,
    data: CommunityWriteData & { readonly name: string },
  ): Promise<CommunityRecord>;
  runSerializable<T>(
    operation: (transaction: CommunityTransactionClient) => Promise<T>,
  ): Promise<T>;
}

const WRITE_CONFLICT_CODE = 'P2034';
const UNIQUE_VIOLATION_CODE = 'P2002';
const RECORD_NOT_FOUND = 'P2025';

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  Reflect.get(error, 'code') === code;

const ownerSelect = {
  name: true,
  username: true,
  profilePicture: true,
  blueTick: true,
  goldenTick: true,
} satisfies Prisma.UserSelect;

const communityInclude = {
  users: { select: ownerSelect },
} satisfies Prisma.CommunityInclude;

type CommunityRow = Prisma.CommunityGetPayload<{
  include: typeof communityInclude;
}>;

const toRecord = (row: CommunityRow): CommunityRecord =>
  Object.freeze({
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    owner:
      row.users === null
        ? null
        : Object.freeze({
            name: row.users.name,
            username: row.users.username,
            profilePicture: row.users.profilePicture,
            blueTick: row.users.blueTick,
            goldenTick: row.users.goldenTick,
          }),
    isPrivate: row.isPrivate,
    isActive: row.isActive,
    memberCount: row.memberCount,
    tags: Object.freeze([...row.tags]),
    profile: toJsonValue(row.profile),
    settings: toJsonValue(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const asWrite = (
  data: CommunityWriteData,
): Prisma.CommunityUncheckedUpdateInput => ({
  ...(data.name === undefined ? {} : { name: data.name }),
  ...(data.description === undefined ? {} : { description: data.description }),
  ...(data.isPrivate === undefined ? {} : { isPrivate: data.isPrivate }),
  ...(data.tags === undefined ? {} : { tags: [...data.tags] }),
  ...(data.settings === undefined
    ? {}
    : { settings: jsonInput(data.settings) }),
  ...(data.profile === undefined ? {} : { profile: jsonInput(data.profile) }),
  ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
});

/**
 * Legacy ran three `contains` predicates even when no term was supplied, since
 * it defaulted the term to an empty string. An absent term now means no filter.
 */
const searchFilter = (search: string | null): Prisma.CommunityWhereInput =>
  search === null
    ? {}
    : {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { tags: { has: search } },
        ],
      };

const memberUserSelect = {
  user: { select: { name: true, username: true, profilePicture: true } },
} satisfies Prisma.CommunityMemberInclude;

type MemberRow = Prisma.CommunityMemberGetPayload<{
  include: typeof memberUserSelect;
}>;

const toSummary = (row: MemberRow): MemberSummary =>
  Object.freeze({
    name: row.user.name,
    username: row.user.username,
    profilePicture: row.user.profilePicture,
  });

const transactionOps = (
  transaction: Prisma.TransactionClient,
): CommunityTransactionClient => ({
  async findById(id) {
    const row = await transaction.community.findUnique({
      where: { id },
      include: communityInclude,
    });
    return row === null ? null : toRecord(row);
  },

  async findMembership(communityId, userId) {
    const row = await transaction.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    return row === null
      ? null
      : Object.freeze({
          communityId: row.communityId,
          userId: row.userId,
          role: row.role,
          status: row.status,
        });
  },

  async update(id, data) {
    const row = await transaction.community.update({
      where: { id },
      data: asWrite(data),
      include: communityInclude,
    });
    return toRecord(row);
  },

  async addMember(communityId, userId, role, status) {
    try {
      await transaction.communityMember.create({
        data: { communityId, userId, role, status },
      });
      return true;
    } catch (error: unknown) {
      // The unique constraint decides; a duplicate is not an error here.
      if (hasCode(error, UNIQUE_VIOLATION_CODE)) return false;
      throw error;
    }
  },

  async removeMember(communityId, userId) {
    const removed = await transaction.communityMember.deleteMany({
      where: { communityId, userId },
    });
    return removed.count > 0;
  },

  async adjustMemberCount(communityId, delta) {
    await transaction.community.update({
      where: { id: communityId },
      data: { memberCount: { increment: delta } },
    });
  },

  async setMemberCount(communityId, value) {
    await transaction.community.update({
      where: { id: communityId },
      data: { memberCount: value },
    });
  },

  async findChatId(communityId) {
    const chat = await transaction.chat.findFirst({
      where: { communityId },
      select: { id: true },
    });
    return chat === null ? null : chat.id;
  },

  async addChatMember(chatId, userId) {
    try {
      await transaction.chatMember.create({ data: { chatId, userId } });
    } catch (error: unknown) {
      if (!hasCode(error, UNIQUE_VIOLATION_CODE)) throw error;
    }
  },

  async removeChatMember(chatId, userId) {
    try {
      await transaction.chatMember.deleteMany({ where: { chatId, userId } });
    } catch (error: unknown) {
      if (!hasCode(error, RECORD_NOT_FOUND)) throw error;
    }
  },

  async clearMembers(communityId) {
    await transaction.communityMember.deleteMany({ where: { communityId } });
  },

  async clearChatMembers(chatId) {
    await transaction.chatMember.deleteMany({ where: { chatId } });
  },
});

export const createCommunityPrismaClient = (
  db: PrismaClient,
): CommunityPrismaClient => ({
  async findById(id) {
    const row = await db.community.findUnique({
      where: { id },
      include: communityInclude,
    });
    return row === null ? null : toRecord(row);
  },

  async findByName(name) {
    const row = await db.community.findFirst({
      where: { name },
      include: communityInclude,
    });
    return row === null ? null : toRecord(row);
  },

  async findMembership(communityId, userId) {
    const row = await db.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    return row === null
      ? null
      : Object.freeze({
          communityId: row.communityId,
          userId: row.userId,
          role: row.role,
          status: row.status,
        });
  },

  async findMembersPreview(communityId, take) {
    const rows = await db.communityMember.findMany({
      where: { communityId },
      include: memberUserSelect,
      take,
    });
    return Object.freeze(rows.map(toSummary));
  },

  async findModerators(communityId) {
    const rows = await db.communityMember.findMany({
      where: { communityId, role: 'moderator' },
      include: memberUserSelect,
    });
    return Object.freeze(rows.map(toSummary));
  },

  async list(search, skip, take) {
    const rows = await db.community.findMany({
      where: { isActive: true, ...searchFilter(search) },
      include: communityInclude,
      orderBy: [{ memberCount: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async count(search) {
    return db.community.count({
      where: { isActive: true, ...searchFilter(search) },
    });
  },

  async listMine(userId, search, skip, take) {
    const rows = await db.community.findMany({
      where: mineWhere(userId, search),
      include: communityInclude,
      orderBy: [{ memberCount: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async countMine(userId, search) {
    return db.community.count({ where: mineWhere(userId, search) });
  },

  async hasGoldenTick(userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { goldenTick: true },
    });
    return user === null ? null : user.goldenTick;
  },

  async createWithOwner(ownerId, data) {
    const row = await db.$transaction(async (transaction) => {
      const community = await transaction.community.create({
        data: {
          name: data.name,
          ...(data.description === undefined
            ? {}
            : { description: data.description }),
          ownerId,
          isPrivate: data.isPrivate ?? false,
          tags: data.tags === undefined ? [] : [...data.tags],
          // The owner is the first member.
          memberCount: 1,
          isActive: true,
        },
        include: communityInclude,
      });

      await transaction.chat.create({
        data: {
          isGroup: true,
          groupName: data.name,
          isCommunityChat: true,
          communityId: community.id,
          groupAdminId: ownerId,
          updatedAt: new Date(),
          members: { create: { userId: ownerId } },
        },
      });

      await transaction.communityMember.create({
        data: {
          communityId: community.id,
          userId: ownerId,
          role: 'owner',
          status: 'active',
        },
      });

      return community;
    });
    return toRecord(row);
  },

  async runSerializable<T>(
    operation: (transaction: CommunityTransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (transaction) => operation(transactionOps(transaction)),
          { isolationLevel: 'Serializable' },
        );
      } catch (error: unknown) {
        if (!hasCode(error, WRITE_CONFLICT_CODE)) throw error;
      }
    }
    throw new DomainError(
      'CONFLICT',
      'That community is being updated. Please try again.',
    );
  },
});

/** Owned, joined, or followed — exactly the legacy definition of "mine". */
const mineWhere = (
  userId: string,
  search: string | null,
): Prisma.CommunityWhereInput => ({
  isActive: true,
  OR: [
    { ownerId: userId },
    { community_members: { some: { userId, status: 'active' } } },
    { community_followers: { some: { userId } } },
  ],
  ...(search === null ? {} : { AND: [searchFilter(search)] }),
});
