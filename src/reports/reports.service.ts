import { Injectable, Logger } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  parseModerationDecision,
  parseReportCreate,
  type ReportListQuery,
  type ReportView,
} from './report.contract';
import {
  createReportPrismaClient,
  type ReportPrismaClient,
  type ReportRecord,
} from './report-prisma.client';

export interface ReportListResult {
  readonly success: true;
  readonly reports: readonly ReportView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
  }>;
}

export interface WarnResult {
  readonly success: true;
  readonly message: string;
  readonly warningCount: number;
}

export interface BanResult {
  readonly success: true;
  readonly message: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get reports(): ReportPrismaClient {
    return createReportPrismaClient(this.prisma.db);
  }

  async create(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<{ readonly success: true; readonly report: ReportView }> {
    const input = parseReportCreate(body);
    const record = await this.reports.create({
      reporterId: principal.userId,
      reportedId: input.reportedId,
      entityId: input.entityId,
      entityType: input.entityType,
      reason: input.reason,
    });
    return Object.freeze({
      success: true as const,
      report: projectReport(record),
    });
  }

  /**
   * Legacy loaded every report ever filed with no limit; the queue is paged.
   */
  async listForReview(
    principal: AuthenticatedPrincipal,
    query: ReportListQuery,
  ): Promise<ReportListResult> {
    requireAdministrator(principal);
    const [records, total] = await Promise.all([
      this.reports.findMany(
        query.status,
        (query.page - 1) * query.limit,
        query.limit,
      ),
      this.reports.count(query.status),
    ]);
    return Object.freeze({
      success: true as const,
      reports: Object.freeze(records.map(projectReport)),
      pagination: Object.freeze({
        current: query.page,
        pages: Math.ceil(total / query.limit),
        total,
      }),
    });
  }

  async warn(
    principal: AuthenticatedPrincipal,
    userId: string,
    body: unknown,
  ): Promise<WarnResult> {
    const decision = this.requireModerator(principal, body);
    const target = await this.requireTarget(userId);
    const warningCount = await this.reports.incrementWarning(target.id);
    await this.notify(
      principal,
      target.id,
      'Warning Issued',
      `You have received a warning: ${decision.reason}. Total warnings: ${warningCount}.`,
    );
    return Object.freeze({
      success: true as const,
      message: 'User warned',
      warningCount,
    });
  }

  async ban(
    principal: AuthenticatedPrincipal,
    userId: string,
    body: unknown,
  ): Promise<BanResult> {
    const decision = this.requireModerator(principal, body);
    const target = await this.requireTarget(userId);
    // Banning an already-banned account is a no-op that still reports success,
    // so a retried request cannot fail.
    if (!target.banned) {
      await this.reports.setBanned(target.id, true);
      await this.notify(
        principal,
        target.id,
        'Account Suspended',
        `Your account has been suspended. Reason: ${decision.reason}.`,
      );
    }
    return Object.freeze({ success: true as const, message: 'User banned' });
  }

  /**
   * Moderation requires an administrator with a confirmed two-factor session,
   * and an auditable reason. Legacy accepted a warn or ban with no reason at
   * all and substituted a generic string.
   */
  private requireModerator(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): { readonly reason: string } {
    requireAdministrator(principal);
    if (principal.twoFactorEnabled && !principal.twoFactorSatisfied) {
      throw new DomainError(
        'TWO_FACTOR_REQUIRED',
        'Confirm two-factor authentication to moderate an account.',
      );
    }
    return parseModerationDecision(body);
  }

  private async requireTarget(
    userId: string,
  ): Promise<{ readonly id: string; readonly banned: boolean }> {
    const target = await this.reports.findUser(userId);
    if (target === null) {
      throw new DomainError('NOT_FOUND', 'User not found.');
    }
    return target;
  }

  /** Notifying is best effort: it must not undo a completed moderation. */
  private async notify(
    principal: AuthenticatedPrincipal,
    recipientId: string,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      await this.reports.createSystemNotification({
        recipientId,
        senderId: principal.userId,
        title,
        message,
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Moderation notification was not delivered: ${reason}`);
    }
  }
}

function requireAdministrator(principal: AuthenticatedPrincipal): void {
  if (!principal.isAdmin) {
    throw new DomainError(
      'AUTHORIZATION_DENIED',
      'Administrator access is required.',
    );
  }
}

const projectReport = (record: ReportRecord): ReportView =>
  Object.freeze({
    id: record.id,
    reporterId: record.reporterId,
    reportedId: record.reportedId,
    entityId: record.entityId,
    entityType: record.entityType,
    reason: record.reason,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
  });
