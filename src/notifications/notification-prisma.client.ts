import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { toJsonValue, type JsonValue } from '../common/json/json-value';
import type { PostAuthorView } from '../posts/post.contract';

export interface NotificationRecord {
  readonly id: string;
  readonly recipientId: string;
  readonly type: string;
  readonly title: string | null;
  readonly message: string | null;
  readonly entityId: string | null;
  readonly entityType: string | null;
  readonly read: boolean;
  readonly metadata: JsonValue;
  readonly sender: PostAuthorView | null;
  readonly createdAt: Date;
}

export interface NotificationPageQuery {
  readonly recipientId: string;
  readonly type: string | null;
  readonly unreadOnly: boolean;
  readonly skip: number;
  readonly take: number;
}

export interface NotificationPrismaClient {
  findMany(
    query: NotificationPageQuery,
  ): Promise<readonly NotificationRecord[]>;
  count(query: Omit<NotificationPageQuery, 'skip' | 'take'>): Promise<number>;
  countUnread(recipientId: string): Promise<number>;
  findById(id: string): Promise<NotificationRecord | null>;
  markRead(id: string): Promise<NotificationRecord>;
  markAllRead(recipientId: string): Promise<void>;
  delete(id: string): Promise<void>;
  readSettings(userId: string): Promise<JsonValue>;
  writeSettings(userId: string, settings: JsonValue): Promise<JsonValue>;
  writePushToken(userId: string, token: string): Promise<void>;
  /** Used by the relay to discover rows written by any producer. */
  findCreatedAfter(
    after: Date,
    take: number,
  ): Promise<readonly NotificationRecord[]>;
}

const senderSelect = {
  id: true,
  name: true,
  username: true,
  profilePicture: true,
  blueTick: true,
  goldenTick: true,
} satisfies Prisma.UserSelect;

const notificationInclude = {
  sender: { select: senderSelect },
} satisfies Prisma.NotificationInclude;

type NotificationRow = Prisma.NotificationGetPayload<{
  include: typeof notificationInclude;
}>;

const toRecord = (row: NotificationRow): NotificationRecord =>
  Object.freeze({
    id: row.id,
    recipientId: row.recipientId,
    type: row.type,
    title: row.title,
    message: row.message,
    entityId: row.entityId,
    entityType: row.entityType,
    read: row.read,
    metadata: toJsonValue(row.metadata),
    sender:
      row.sender === null
        ? null
        : Object.freeze({
            id: row.sender.id,
            name: row.sender.name,
            username: row.sender.username,
            profilePicture: row.sender.profilePicture,
            blueTick: row.sender.blueTick,
            goldenTick: row.sender.goldenTick,
          }),
    createdAt: row.createdAt,
  });

const whereOf = (
  query: Omit<NotificationPageQuery, 'skip' | 'take'>,
): Prisma.NotificationWhereInput => ({
  recipientId: query.recipientId,
  ...(query.type === null ? {} : { type: query.type }),
  ...(query.unreadOnly ? { read: false } : {}),
});

export const createNotificationPrismaClient = (
  db: PrismaClient,
): NotificationPrismaClient => ({
  async findMany({ skip, take, ...rest }) {
    const rows = await db.notification.findMany({
      where: whereOf(rest),
      include: notificationInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async count(query) {
    return db.notification.count({ where: whereOf(query) });
  },

  async countUnread(recipientId) {
    return db.notification.count({ where: { recipientId, read: false } });
  },

  async findById(id) {
    const row = await db.notification.findUnique({
      where: { id },
      include: notificationInclude,
    });
    return row === null ? null : toRecord(row);
  },

  async markRead(id) {
    const row = await db.notification.update({
      where: { id },
      data: { read: true },
      include: notificationInclude,
    });
    return toRecord(row);
  },

  async markAllRead(recipientId) {
    await db.notification.updateMany({
      where: { recipientId, read: false },
      data: { read: true },
    });
  },

  async delete(id) {
    await db.notification.delete({ where: { id } });
  },

  async readSettings(userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { notificationSettings: true },
    });
    return row === null ? null : toJsonValue(row.notificationSettings);
  },

  async writeSettings(userId, settings) {
    const row = await db.user.update({
      where: { id: userId },
      data: { notificationSettings: settings as Prisma.InputJsonValue },
      select: { notificationSettings: true },
    });
    return toJsonValue(row.notificationSettings);
  },

  async writePushToken(userId, token) {
    await db.user.update({ where: { id: userId }, data: { pushToken: token } });
  },

  async findCreatedAfter(after, take) {
    const rows = await db.notification.findMany({
      where: { createdAt: { gt: after } },
      include: notificationInclude,
      orderBy: { createdAt: 'asc' },
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },
});
