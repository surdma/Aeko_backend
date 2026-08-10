import type { Prisma, PrismaClient } from '../generated/prisma/client';

export interface ReportPartyView {
  readonly id: string;
  readonly username: string;
  readonly email: string;
}

export interface ReportedPartyView extends ReportPartyView {
  readonly warningCount: number;
  readonly banned: boolean;
}

export interface ReportRecord {
  readonly id: string;
  readonly reporterId: string;
  readonly reportedId: string | null;
  readonly entityId: string | null;
  readonly entityType: string;
  readonly reason: string;
  readonly status: string;
  readonly reporter: ReportPartyView | null;
  readonly reported: ReportedPartyView | null;
  readonly createdAt: Date;
}

export interface ReportWriteData {
  readonly reporterId: string;
  readonly reportedId: string | null;
  readonly entityId: string;
  readonly entityType: string;
  readonly reason: string;
}

export interface ModerationTarget {
  readonly id: string;
  readonly username: string | null;
  readonly email: string;
  readonly warningCount: number;
  readonly banned: boolean;
}

export interface ReportPrismaClient {
  create(data: ReportWriteData): Promise<ReportRecord>;
  findMany(
    status: string | null,
    skip: number,
    take: number,
  ): Promise<readonly ReportRecord[]>;
  count(status: string | null): Promise<number>;
  findUser(id: string): Promise<ModerationTarget | null>;
  incrementWarning(id: string): Promise<number>;
  setBanned(id: string, banned: boolean): Promise<void>;
  createSystemNotification(input: {
    readonly recipientId: string;
    readonly senderId: string;
    readonly title: string;
    readonly message: string;
  }): Promise<void>;
}

const reportInclude = {
  reporter: { select: { id: true, username: true, email: true } },
  reported: {
    select: {
      id: true,
      username: true,
      email: true,
      warningCount: true,
      banned: true,
    },
  },
} satisfies Prisma.ReportInclude;

type ReportRow = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

const toRecord = (row: ReportRow): ReportRecord =>
  Object.freeze({
    id: row.id,
    reporterId: row.reporterId,
    reportedId: row.reportedId,
    entityId: row.entityId,
    entityType: row.entityType,
    reason: row.reason,
    status: row.status,
    reporter:
      row.reporter === null
        ? null
        : Object.freeze({
            id: row.reporter.id,
            username: row.reporter.username,
            email: row.reporter.email,
          }),
    reported:
      row.reported === null
        ? null
        : Object.freeze({
            id: row.reported.id,
            username: row.reported.username,
            email: row.reported.email,
            warningCount: row.reported.warningCount,
            banned: row.reported.banned,
          }),
    createdAt: row.createdAt,
  });

export const createReportPrismaClient = (
  db: PrismaClient,
): ReportPrismaClient => ({
  async create(data) {
    const row = await db.report.create({
      data: { ...data },
      include: reportInclude,
    });
    return toRecord(row);
  },

  async findMany(status, skip, take) {
    const rows = await db.report.findMany({
      where: status === null ? {} : { status },
      include: reportInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return Object.freeze(rows.map(toRecord));
  },

  async count(status) {
    return db.report.count({ where: status === null ? {} : { status } });
  },

  async findUser(id) {
    const row = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        warningCount: true,
        banned: true,
      },
    });
    return row === null ? null : Object.freeze({ ...row });
  },

  async incrementWarning(id) {
    const row = await db.user.update({
      where: { id },
      data: { warningCount: { increment: 1 } },
      select: { warningCount: true },
    });
    return row.warningCount;
  },

  async setBanned(id, banned) {
    await db.user.update({ where: { id }, data: { banned } });
  },

  async createSystemNotification({ recipientId, senderId, title, message }) {
    await db.notification.create({
      data: {
        recipientId,
        senderId,
        type: 'SYSTEM',
        title,
        message,
        entityId: recipientId,
        entityType: 'USER',
      },
    });
  },
});
