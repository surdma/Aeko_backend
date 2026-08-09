import { z } from 'zod';

import { DomainError } from '../common/errors/domain.error';

export type ProfileVisibility = 'public' | 'private';

export interface PrivacySettings {
  readonly profileVisibility: ProfileVisibility;
  readonly showFollowers: boolean;
  readonly showFollowing: boolean;
  readonly allowMessages: boolean;
  readonly allowFollowRequests: boolean;
}

export type FollowRequestStatus = 'pending' | 'accepted' | 'rejected';

const privacySettingsSchema = z.preprocess(
  (input) => (input === null || input === undefined ? {} : input),
  z
    .object({
      profileVisibility: z.enum(['public', 'private']).default('public'),
      showFollowers: z.boolean().default(true),
      showFollowing: z.boolean().default(true),
      allowMessages: z.boolean().default(true),
      allowFollowRequests: z.boolean().default(true),
    })
    .strict(),
);

const followRequestStatusSchema = z.enum(['pending', 'accepted', 'rejected']);

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

  if (!result.success) {
    throw validationError('privacy settings', result.error.issues);
  }

  return result.data;
};

export const parseFollowRequestStatus = (
  input: unknown,
): FollowRequestStatus => {
  const result = followRequestStatusSchema.safeParse(input);

  if (!result.success) {
    throw validationError('status', result.error.issues);
  }

  return result.data;
};
