import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

/**
 * The profile route edits two columns and two keys inside the `profile` JSON.
 * `name` and `description` are columns; `website` and `location` are merged
 * into `profile`, exactly as legacy did.
 */
export interface CommunityProfileUpdate {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly website?: string | undefined;
  readonly location?: string | undefined;
}

/** Legacy read the photo kind from the query string, not the body. */
export type CommunityPhotoKind = 'avatar' | 'cover';

export interface CommunityPhotoQuery {
  readonly type: CommunityPhotoKind;
}

export interface CommunitySettingsUpdate {
  readonly settings: Readonly<Record<string, JsonValue>>;
}

export interface CommunityPostCreate {
  readonly content: string;
  readonly media: readonly string[];
}

export interface CommunityPostQuery {
  readonly page: number;
  readonly limit: number;
}

export interface CommunityPostAuthorView {
  readonly name: string;
  readonly username: string;
  readonly profilePicture: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
}

export interface CommunityPostView {
  readonly id: string;
  readonly text: string | null;
  readonly userId: string;
  readonly communityId: string | null;
  readonly media: JsonValue;
  readonly type: string;
  readonly status: string;
  readonly createdAt: string;
  readonly user: CommunityPostAuthorView | null;
  readonly community: Readonly<{ name: string; profile: JsonValue }> | null;
}

export interface CommunityPostPage {
  readonly posts: readonly CommunityPostView[];
  readonly pagination: Readonly<{
    total: number;
    page: number;
    pages: number;
    limit: number;
  }>;
}

const profileUpdateSchema = z
  .object({
    name: boundedText(200).optional(),
    description: boundedText(5_000).optional(),
    website: boundedText(500).optional(),
    location: boundedText(200).optional(),
  })
  .strip();

/**
 * Legacy rejected any value other than `avatar` or `cover`, and treated an
 * absent value as `avatar` when writing the profile key.
 */
const photoQuerySchema = z
  .object({ type: z.enum(['avatar', 'cover']).default('avatar') })
  .strip();

const settingsUpdateSchema = z
  .object({
    settings: z.record(z.string(), z.unknown()),
  })
  .strip() as unknown as z.ZodType<CommunitySettingsUpdate>;

const postCreateSchema = z
  .object({
    content: z.string().trim().min(1).max(10_000),
    media: z.array(boundedText(1_000)).max(20).default([]),
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

export const parseCommunityPhotoQuery = (input: unknown): CommunityPhotoQuery =>
  Object.freeze(parseWithScope(photoQuerySchema, input, 'photo'));

export const parseCommunitySettingsUpdate = (
  input: unknown,
): CommunitySettingsUpdate =>
  Object.freeze(parseWithScope(settingsUpdateSchema, input, 'settings'));

export const parseCommunityPostCreate = (input: unknown): CommunityPostCreate =>
  Object.freeze(parseWithScope(postCreateSchema, input, 'post'));

export const parseCommunityPostQuery = (input: unknown): CommunityPostQuery =>
  Object.freeze(parseWithScope(postQuerySchema, input, 'post query'));
