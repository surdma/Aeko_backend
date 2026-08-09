import { z } from 'zod';

import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

export const REPORT_ENTITY_TYPES = ['USER', 'POST', 'COMMENT'] as const;
export type ReportEntityType = (typeof REPORT_ENTITY_TYPES)[number];

export interface ReportCreate {
  readonly entityType: ReportEntityType;
  readonly entityId: string;
  readonly reportedId: string | null;
  readonly reason: string;
}

/**
 * Legacy accepted a warn or ban with no reason and substituted a generic
 * string, leaving no auditable record of why the action was taken.
 */
export interface ModerationDecision {
  readonly reason: string;
  readonly durationDays: number | null;
}

export interface ReportListQuery {
  readonly page: number;
  readonly limit: number;
  readonly status: string | null;
}

export interface ReportView {
  readonly id: string;
  readonly reporterId: string;
  readonly reportedId: string | null;
  readonly entityId: string | null;
  readonly entityType: string;
  readonly reason: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface ReportPage {
  readonly reports: readonly ReportView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
  }>;
}

const reportCreateSchema = z
  .object({
    entityType: z.enum(REPORT_ENTITY_TYPES),
    entityId: boundedText(200),
    reportedId: boundedText(200).nullable().default(null),
    reason: boundedText(2_000),
  })
  .strict();

const moderationSchema = z
  .object({
    reason: boundedText(2_000),
    durationDays: z.coerce
      .number()
      .int()
      .positive()
      .max(3_650)
      .nullable()
      .default(null),
  })
  .strict();

const reportListQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(20, 100).default(20),
    status: boundedText(50).nullable().default(null),
  })
  .strip();

export const parseReportCreate = (input: unknown): ReportCreate =>
  Object.freeze(parseWithScope(reportCreateSchema, input, 'report'));

export const parseModerationDecision = (input: unknown): ModerationDecision =>
  Object.freeze(parseWithScope(moderationSchema, input, 'reason'));

export const parseReportListQuery = (input: unknown): ReportListQuery =>
  Object.freeze(parseWithScope(reportListQuerySchema, input, 'report query'));
