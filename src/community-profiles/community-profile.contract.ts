import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

export interface CommunityProfileUpdate {
  readonly displayName?: string | undefined;
  readonly bio?: string | undefined;
  readonly website?: string | undefined;
  readonly location?: string | undefined;
  readonly bannerImage?: string | undefined;
  readonly profileImage?: string | undefined;
}

export type CommunityPhotoKind = 'profile' | 'banner';

export interface CommunityPhotoUpload {
  readonly type: CommunityPhotoKind;
}

export interface CommunitySettingsUpdate {
  readonly settings: Readonly<Record<string, JsonValue>>;
}

export interface CommunityPostCreate {
  readonly content: string;
  readonly mediaUrl: string | null;
}

export interface CommunityPostQuery {
  readonly page: number;
  readonly limit: number;
}

export interface CommunityFollowResult {
  readonly success: true;
  readonly message: string;
  readonly followerCount: number;
}

const optionalText = (maximum: number) => boundedText(maximum).optional();

const profileUpdateSchema = z
  .object({
    displayName: optionalText(200),
    bio: optionalText(1_000),
    website: optionalText(500),
    location: optionalText(200),
    bannerImage: optionalText(1_000),
    profileImage: optionalText(1_000),
  })
  .strip();

/** Legacy read `req.body.type`, defaulting to a profile photo. */
const photoUploadSchema = z
  .object({ type: z.enum(['profile', 'banner']).default('profile') })
  .strip();

const settingsUpdateSchema = z
  .object({
    settings: z.record(z.string(), z.unknown()),
  })
  .strip() as unknown as z.ZodType<CommunitySettingsUpdate>;

const postCreateSchema = z
  .object({
    content: z.string().trim().min(1).max(10_000),
    mediaUrl: boundedText(1_000).nullable().default(null),
  })
  .strip();

const postQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(10, 100).default(10),
  })
  .strip();

export const parseCommunityProfileUpdate = (
  input: unknown,
): CommunityProfileUpdate =>
  Object.freeze(parseWithScope(profileUpdateSchema, input, 'profile'));

export const parseCommunityPhotoUpload = (
  input: unknown,
): CommunityPhotoUpload =>
  Object.freeze(parseWithScope(photoUploadSchema, input, 'photo'));

export const parseCommunitySettingsUpdate = (
  input: unknown,
): CommunitySettingsUpdate =>
  Object.freeze(parseWithScope(settingsUpdateSchema, input, 'settings'));

export const parseCommunityPostCreate = (input: unknown): CommunityPostCreate =>
  Object.freeze(parseWithScope(postCreateSchema, input, 'post'));

export const parseCommunityPostQuery = (input: unknown): CommunityPostQuery =>
  Object.freeze(parseWithScope(postQuerySchema, input, 'post query'));
