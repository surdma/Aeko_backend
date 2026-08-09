import { z } from 'zod';

import { DomainError } from '../common/errors/domain.error';
import {
  parsePageQuery,
  type PageMeta,
  type PageQuery,
} from '../common/pagination/page-query';
import type { UserSummary } from '../users/user.contract';

export type DirectMessageAudience = 'everyone' | 'followers' | 'none';

export interface PrivacySettings {
  readonly isPrivate: boolean;
  readonly allowFollowRequests: boolean;
  readonly showOnlineStatus: boolean;
  readonly allowDirectMessages: DirectMessageAudience;
  readonly allowComments: boolean;
  readonly allowTags: boolean;
}
export type PrivacyUpdate = Partial<PrivacySettings>;

export type FollowRequestAction = 'approve' | 'reject';
export type FollowRequestStatus = 'pending' | 'approved' | 'rejected';
export type FollowRequestFilter = FollowRequestStatus | 'all';

export interface FollowRequestQuery extends PageQuery {
  readonly status: FollowRequestFilter;
}

export interface FollowRequestItem {
  readonly user: UserSummary;
  readonly requestedAt: string;
  readonly status: FollowRequestStatus;
}

export interface FollowRequestPage {
  readonly requests: readonly FollowRequestItem[];
  readonly page: PageMeta;
}

export interface SecurityEventQuery extends PageQuery {
  readonly eventType: string | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}

export type SecurityMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly SecurityMetadataValue[]
  | SecurityMetadataObject;

export interface SecurityMetadataObject {
  readonly [key: string]: SecurityMetadataValue;
}

export interface SecurityEventView {
  readonly id: string;
  readonly eventType: string;
  readonly targetUserId: string | null;
  readonly metadata: Readonly<Record<string, SecurityMetadataValue>>;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly timestamp: string;
  readonly success: boolean;
}

export interface SecurityEventPage {
  readonly events: readonly SecurityEventView[];
  readonly page: PageMeta;
}

export interface SecurityEventStat {
  readonly eventType: string;
  readonly count: number;
  readonly lastOccurrence: string;
}

export interface SecurityEventStats {
  readonly total: number;
  readonly events: readonly SecurityEventStat[];
}

const privacyFields = z
  .object({
    isPrivate: z.boolean(),
    allowFollowRequests: z.boolean(),
    showOnlineStatus: z.boolean(),
    allowDirectMessages: z.enum(['everyone', 'followers', 'none']),
    allowComments: z.boolean(),
    allowTags: z.boolean(),
  })
  .strict();

const privacySettingsSchema = z.preprocess(
  (input) => (input === null || input === undefined ? {} : input),
  z
    .object({
      isPrivate: z.boolean().default(false),
      allowFollowRequests: z.boolean().default(true),
      showOnlineStatus: z.boolean().default(true),
      allowDirectMessages: z
        .enum(['everyone', 'followers', 'none'])
        .default('everyone'),
      allowComments: z.boolean().default(true),
      allowTags: z.boolean().default(true),
    })
    .strict(),
);
const privacyUpdateSchema = privacyFields.partial();

const actionSchema = z
  .object({ action: z.enum(['approve', 'reject']) })
  .strict();
const filterSchema = z
  .enum(['pending', 'approved', 'rejected', 'all'])
  .default('pending');
const userIdSchema = z.string().trim().min(1).max(128);

const validationError = (
  subject: string,
  issues: readonly z.core.$ZodIssue[],
): DomainError => {
  const details: Record<string, readonly string[]> = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : subject;
    details[field] = [...(details[field] ?? []), issue.message];
  }
  return new DomainError(
    'VALIDATION_FAILED',
    `Invalid ${subject}: ${Object.keys(details).join(', ')}`,
    details,
  );
};

export const parsePrivacySettings = (input: unknown): PrivacySettings => {
  const result = privacySettingsSchema.safeParse(input);
  if (!result.success)
    throw validationError('privacy settings', result.error.issues);
  return Object.freeze(result.data);
};

export const parsePrivacyUpdate = (input: unknown): PrivacyUpdate => {
  const result = privacyUpdateSchema.safeParse(input);
  if (!result.success)
    throw validationError('privacy settings', result.error.issues);
  return Object.freeze({
    ...(result.data.isPrivate === undefined
      ? {}
      : { isPrivate: result.data.isPrivate }),
    ...(result.data.allowFollowRequests === undefined
      ? {}
      : { allowFollowRequests: result.data.allowFollowRequests }),
    ...(result.data.showOnlineStatus === undefined
      ? {}
      : { showOnlineStatus: result.data.showOnlineStatus }),
    ...(result.data.allowDirectMessages === undefined
      ? {}
      : { allowDirectMessages: result.data.allowDirectMessages }),
    ...(result.data.allowComments === undefined
      ? {}
      : { allowComments: result.data.allowComments }),
    ...(result.data.allowTags === undefined
      ? {}
      : { allowTags: result.data.allowTags }),
  });
};

export const parseFollowRequestAction = (
  input: unknown,
): FollowRequestAction => {
  const result = actionSchema.safeParse(input);
  if (!result.success)
    throw validationError('follow request action', result.error.issues);
  return result.data.action;
};

export const parseFollowRequestStatus = (
  input: unknown,
): FollowRequestStatus => {
  const result = z.enum(['pending', 'approved', 'rejected']).safeParse(input);
  if (!result.success) throw validationError('status', result.error.issues);
  return result.data;
};

export const parseFollowRequestQuery = (input: unknown): FollowRequestQuery => {
  const page = parsePageQuery(input);
  const statusValue: unknown =
    typeof input === 'object' && input !== null
      ? Reflect.get(input, 'status')
      : undefined;
  const result = filterSchema.safeParse(statusValue);
  if (!result.success) throw validationError('status', result.error.issues);
  return Object.freeze({ ...page, status: result.data });
};

export const parseBlockReason = (input: unknown): string | null => {
  const value: unknown =
    typeof input === 'object' && input !== null
      ? Reflect.get(input, 'reason')
      : input;
  if (value === undefined || value === null || value === '') return null;
  const result = z.string().trim().min(1).max(500).safeParse(value);
  if (!result.success)
    throw validationError('block reason', result.error.issues);
  return result.data;
};

export const parseSocialUserId = (input: unknown): string => {
  const result = userIdSchema.safeParse(input);
  if (!result.success) throw validationError('userId', result.error.issues);
  return result.data;
};

const parseOptionalDate = (input: unknown, field: string): Date | null => {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') {
    throw validationError('security event query', [
      {
        code: 'custom',
        path: [field],
        message: 'Expected an ISO date string.',
        input,
      },
    ]);
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw validationError('security event query', [
      {
        code: 'custom',
        path: [field],
        message: 'Expected an ISO date string.',
        input,
      },
    ]);
  }
  return date;
};

export const parseSecurityEventQuery = (input: unknown): SecurityEventQuery => {
  const page = parsePageQuery(input);
  const source = typeof input === 'object' && input !== null ? input : {};
  const rawEventType: unknown = Reflect.get(source, 'eventType');
  const eventTypeResult = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .safeParse(rawEventType);
  const eventType =
    rawEventType === undefined || rawEventType === null || rawEventType === ''
      ? null
      : eventTypeResult.success
        ? eventTypeResult.data
        : (() => {
            throw validationError(
              'security event query',
              eventTypeResult.error.issues,
            );
          })();
  const startDate = parseOptionalDate(
    Reflect.get(source, 'startDate'),
    'startDate',
  );
  const endDate = parseOptionalDate(Reflect.get(source, 'endDate'), 'endDate');
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Invalid security event date range.',
    );
  }
  return Object.freeze({ ...page, eventType, startDate, endDate });
};

export const parseSecurityStatsDays = (input: unknown): number => {
  if (input === undefined || input === null || input === '') return 30;
  const numeric =
    typeof input === 'number'
      ? input
      : typeof input === 'string'
        ? Number(input)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Invalid security statistics days.',
    );
  }
  return Math.min(365, Math.max(1, Math.trunc(numeric)));
};

export const parseVerificationTarget = (input: unknown): string => {
  const schema = z
    .object({ userId: z.string().trim().min(1).max(191) })
    .strict();
  const result = schema.safeParse(input);
  if (!result.success)
    throw validationError('verification request', result.error.issues);
  return result.data.userId;
};
