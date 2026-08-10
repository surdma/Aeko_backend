import { Injectable } from '@nestjs/common';

import { DomainError } from '../common/errors/domain.error';
import {
  PrismaService,
  type PrismaTransaction,
} from '../database/prisma/prisma.service';
import type {
  SecurityEventPage,
  SecurityEventQuery,
  SecurityEventStats,
  SecurityEventView,
  SecurityMetadataValue,
} from './security.contract';
import {
  createSecurityEventPrismaClient,
  type CreateSecurityEventData,
  type SecurityEventPrismaClient,
  type SecurityEventRecord,
} from './security-event-prisma.client';

export interface RecordSecurityEventInput {
  readonly userId: string;
  readonly eventType: string;
  readonly targetUserId: string | null;
  readonly success: boolean;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly errorMessage: string | null;
}

@Injectable()
export class SecurityEventService {
  private readonly db: PrismaTransaction;

  constructor(prisma: PrismaService) {
    this.db = prisma.db;
  }

  async record(input: RecordSecurityEventInput): Promise<void> {
    const data: CreateSecurityEventData = Object.freeze({
      ...input,
      eventType: boundedText(input.eventType, 100, 'security event type'),
      ipAddress: boundedText(input.ipAddress, 128, 'IP address'),
      userAgent: boundedText(input.userAgent, 512, 'user agent'),
      metadata: sanitizeMetadata(input.metadata),
      errorMessage: input.errorMessage ? 'Operation failed.' : null,
    });
    try {
      await this.client().create(data);
    } catch (error: unknown) {
      throw sanitizeDatabaseError(error);
    }
  }

  async list(
    userId: string,
    query: SecurityEventQuery,
  ): Promise<SecurityEventPage> {
    try {
      const [records, total] = await Promise.all([
        this.client().list(userId, query),
        this.client().count(userId, query),
      ]);
      return Object.freeze({
        events: Object.freeze(records.map(projectEvent)),
        page: Object.freeze({
          page: query.page,
          limit: query.limit,
          total,
          pages: total === 0 ? 0 : Math.ceil(total / query.limit),
        }),
      });
    } catch (error: unknown) {
      throw sanitizeDatabaseError(error);
    }
  }

  async stats(userId: string, days: number): Promise<SecurityEventStats> {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    try {
      const records = await this.client().stats(userId, startDate);
      const eventStats = records
        .map((record) =>
          Object.freeze({
            eventType: record.eventType,
            count: record.count,
            lastOccurrence: record.lastOccurrence.toISOString(),
          }),
        )
        .sort(
          (left, right) =>
            right.count - left.count ||
            left.eventType.localeCompare(right.eventType),
        );
      return Object.freeze({
        total: eventStats.reduce((total, event) => total + event.count, 0),
        events: Object.freeze(eventStats),
      });
    } catch (error: unknown) {
      throw sanitizeDatabaseError(error);
    }
  }

  private client(): SecurityEventPrismaClient {
    return createSecurityEventPrismaClient(this.db);
  }
}

const projectEvent = (record: SecurityEventRecord): SecurityEventView =>
  Object.freeze({
    id: record.id,
    eventType: record.eventType,
    targetUserId: record.targetUserId,
    metadata: sanitizeMetadata(record.metadata),
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    timestamp: record.timestamp.toISOString(),
    success: record.success,
  });

const sensitiveKey =
  /(?:password|secret|token|authorization|cookie|backup|code|credential)/i;

const sanitizeMetadata = (
  value: unknown,
  depth = 0,
): Readonly<Record<string, SecurityMetadataValue>> => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    depth > 4
  )
    return Object.freeze({});
  const sanitized: Record<string, SecurityMetadataValue> = {};
  for (const key of Object.keys(value)) {
    if (sensitiveKey.test(key)) continue;
    const item = sanitizeValue(Reflect.get(value, key), depth + 1);
    if (item !== undefined) sanitized[key] = item;
  }
  return Object.freeze(sanitized);
};

const sanitizeValue = (
  value: unknown,
  depth: number,
): SecurityMetadataValue | undefined => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    return Object.freeze(
      value.flatMap((item) => {
        const sanitized = sanitizeValue(item, depth + 1);
        return sanitized === undefined ? [] : [sanitized];
      }),
    );
  }
  if (typeof value === 'object') return sanitizeMetadata(value, depth);
  return undefined;
};

const boundedText = (
  value: string,
  maximum: number,
  subject: string,
): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximum) {
    throw new DomainError('VALIDATION_FAILED', `Invalid ${subject}.`);
  }
  return trimmed;
};

const sanitizeDatabaseError = (error: unknown): DomainError =>
  error instanceof DomainError
    ? error
    : new DomainError(
        'DATABASE_UNAVAILABLE',
        'Security history is temporarily unavailable.',
      );
