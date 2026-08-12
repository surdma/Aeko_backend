import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { toJsonValue, type JsonValue } from '../common/json/json-value';

export type WritableJson = Exclude<JsonValue, null>;

export interface PostAuthorRecord {
  readonly name: string;
  readonly username: string;
  readonly profilePicture: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
}

export interface CommunityPostRecord {
  readonly id: string;
  readonly text: string | null;
  readonly userId: string;
  readonly communityId: string | null;
  readonly media: JsonValue;
  readonly type: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly user: PostAuthorRecord | null;
  readonly community: Readonly<{ name: string; profile: JsonValue }> | null;
}

export interface CommunityPostCreateData {
  readonly text: string;
  readonly userId: string;
  readonly communityId: string;
  readonly media: readonly string[];
  readonly type: string;
  readonly status: string;
}

export interface CommunityPostPrismaClient {
  create(data: CommunityPostCreateData): Promise<CommunityPostRecord>;
  findMany(
    where: PostVisibility,
    skip: number,
    take: number,
  ): Promise<readonly CommunityPostRecord[]>;
  count(where: PostVisibility): Promise<number>;
  /** True when the caller holds an elevated role in the community. */
  isModerator(communityId: string, userId: string): Promise<boolean>;
  updateProfile(communityId: string, profile: WritableJson): Promise<void>;
  updateColumns(
    communityId: string,
    data: Readonly<{ name?: string; description?: string }>,
  ): Promise<void>;
  updateSettings(communityId: string, settings: WritableJson): Promise<void>;
}

/**
 * Who may see which posts. Everyone sees active posts; an author also sees
 * their own pending posts; a moderator or owner sees every pending post.
 */
export interface PostVisibility {
  readonly communityId: string;
  readonly viewerId: string | null;
  readonly seesAllPending: boolean;
}

/**
 * The real relation names. Legacy included `user` and `community`, neither of
 * which exists on Post, so Prisma rejected the query and both post routes
 * answered 500 on every call.
 */
const AUTHOR_RELATION = 'users_posts_userIdTouser';
const COMMUNITY_RELATION = 'communities';

const postInclude = {
  [AUTHOR_RELATION]: {
    select: {
      name: true,
      username: true,
      profilePicture: true,
      blueTick: true,
      goldenTick: true,
    },
  },
  [COMMUNITY_RELATION]: { select: { name: true, profile: true } },
} satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

const toRecord = (row: PostRow): CommunityPostRecord =>
  Object.freeze({
    id: row.id,
    text: row.text,
    userId: row.userId,
    communityId: row.communityId,
    media: toJsonValue(row.media),
    type: row.type,
    status: row.status,
    createdAt: row.createdAt,
    user:
      row[AUTHOR_RELATION] === null
        ? null
        : Object.freeze({
            name: row[AUTHOR_RELATION].name,
            username: row[AUTHOR_RELATION].username,
            profilePicture: row[AUTHOR_RELATION].profilePicture,
            blueTick: row[AUTHOR_RELATION].blueTick,
            goldenTick: row[AUTHOR_RELATION].goldenTick,
          }),
    community:
      row[COMMUNITY_RELATION] === null
        ? null
        : Object.freeze({
            name: row[COMMUNITY_RELATION].name,
            profile: toJsonValue(row[COMMUNITY_RELATION].profile),
          }),
  });

const jsonInput = (value: WritableJson): Prisma.InputJsonValue => value;

const visibilityWhere = (visibility: PostVisibility): Prisma.PostWhereInput => {
  const { communityId, viewerId, seesAllPending } = visibility;
  if (viewerId === null) {
    return { communityId, status: 'active' };
  }
  const or: Prisma.PostWhereInput[] = [
    { status: 'active' },
    { userId: viewerId, status: 'pending' },
  ];
  if (seesAllPending) or.push({ status: 'pending' });
  return { communityId, OR: or };
};

export const createCommunityPostPrismaClient = (
  db: PrismaClient,
): CommunityPostPrismaClient => ({
  async create(data) {
    const row = await db.post.create({
      data: {
        text: data.text,
        userId: data.userId,
        communityId: data.communityId,
        media: [...data.media],
        isCommunityPost: true,
        status: data.status,
        type: data.type,
      },
      include: postInclude,
    });
    return toRecord(row);
  },

  async findMany(where, skip, take) {
    const rows = await db.post.findMany({
      where: visibilityWhere(where),
      include: postInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async count(where) {
    return db.post.count({ where: visibilityWhere(where) });
  },

  async isModerator(communityId, userId) {
    const row = await db.communityMember.findFirst({
      where: { communityId, userId, role: { in: ['moderator', 'owner'] } },
      select: { id: true },
    });
    return row !== null;
  },

  async updateProfile(communityId, profile) {
    await db.community.update({
      where: { id: communityId },
      data: { profile: jsonInput(profile) },
    });
  },

  async updateColumns(communityId, data) {
    await db.community.update({
      where: { id: communityId },
      data: {
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.description === undefined
          ? {}
          : { description: data.description }),
      },
    });
  },

  async updateSettings(communityId, settings) {
    await db.community.update({
      where: { id: communityId },
      data: { settings: jsonInput(settings) },
    });
  },
});
