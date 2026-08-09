import { z } from 'zod';

import { DomainError } from '../common/errors/domain.error';
import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

export const POST_TYPES = ['text', 'image', 'video'] as const;
export const PRIVACY_LEVELS = [
  'public',
  'followers',
  'select_users',
  'only_me',
] as const;

export type PostType = (typeof POST_TYPES)[number];
export type PostPrivacyLevel = (typeof PRIVACY_LEVELS)[number];

export interface PostPrivacy {
  readonly level: PostPrivacyLevel;
  readonly selectedUsers: readonly string[];
}

export interface PostCreate {
  readonly text: string;
  readonly type: PostType;
  readonly privacy: PostPrivacy;
}

export interface PostUpdate {
  readonly text: string;
}

export interface PostListQuery {
  readonly page: number;
  readonly limit: number;
}

export interface PostSearchQuery extends PostListQuery {
  readonly q: string;
}

export interface PostAuthorView {
  readonly id: string | null;
  readonly name: string | null;
  readonly username: string | null;
  readonly profilePicture: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
}

/**
 * The legacy response shape. `media` keeps its dual string/array form for
 * backward compatibility while `mediaUrl`/`mediaUrls` are always present.
 */
export interface PostView {
  readonly id: string;
  readonly text: string | null;
  readonly type: PostType;
  readonly userId: string;
  readonly user: PostAuthorView | null;
  readonly media: JsonValue;
  readonly mediaUrl: string | null;
  readonly mediaUrls: readonly string[];
  readonly privacy: PostPrivacy;
  readonly views: number;
  readonly likesCount: number;
  readonly commentsCount: number;
  readonly isLiked: boolean;
  readonly isAnchored: boolean;
  readonly nftTokenId: string | null;
  readonly originalPostId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PostPage {
  readonly posts: readonly PostView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
  }>;
}

const MAX_PAGE_SIZE = 50;

const listQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(20, MAX_PAGE_SIZE).default(20),
  })
  .strip();

const searchQuerySchema = listQuerySchema.extend({
  q: boundedText(200),
});

const privacyLevelSchema = z.enum(PRIVACY_LEVELS);

/**
 * Multipart clients send `selectedUsers` as a JSON string; JSON clients send a
 * real array. Both are accepted, as in Express.
 */
const selectedUsersSchema = z
  .union([z.string(), z.array(z.string().trim().min(1))])
  .transform((value, context) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        Array.isArray(parsed) &&
        parsed.every((entry) => typeof entry === 'string')
      ) {
        return parsed;
      }
    } catch {
      // fall through to the issue below
    }
    context.addIssue({
      code: 'custom',
      message: 'selectedUsers must be a JSON array of user IDs.',
    });
    return z.NEVER;
  })
  .pipe(z.array(z.string().trim().min(1)).max(500));

const postCreateSchema = z
  .object({
    text: z.string().trim().max(10_000).default(''),
    type: z.enum(POST_TYPES),
    privacy: privacyLevelSchema.default('public'),
    selectedUsers: selectedUsersSchema.optional(),
  })
  .strict();

const postUpdateSchema = z
  .object({ text: z.string().trim().max(10_000) })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'update is required',
  });

const postPrivacySchema = z
  .object({
    privacy: privacyLevelSchema,
    selectedUsers: selectedUsersSchema.optional(),
  })
  .strict();

const requireSelection = (
  level: PostPrivacyLevel,
  selectedUsers: readonly string[] | undefined,
  scope: string,
): readonly string[] => {
  if (level !== 'select_users') return [];
  if (selectedUsers === undefined || selectedUsers.length === 0) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Invalid ${scope}: selectedUsers`,
      { [scope]: ['Choose at least one person who can see this post.'] },
    );
  }
  return Object.freeze([...selectedUsers]);
};

export const parsePostListQuery = (input: unknown): PostListQuery =>
  Object.freeze(parseWithScope(listQuerySchema, input, 'post query'));

export const parsePostSearchQuery = (input: unknown): PostSearchQuery =>
  Object.freeze(parseWithScope(searchQuerySchema, input, 'q'));

export const parsePostCreate = (input: unknown): PostCreate => {
  const value = parseWithScope(postCreateSchema, input, 'post');
  return Object.freeze({
    text: value.text,
    type: value.type,
    privacy: Object.freeze({
      level: value.privacy,
      selectedUsers: requireSelection(
        value.privacy,
        value.selectedUsers,
        'post',
      ),
    }),
  });
};

export const parsePostUpdate = (input: unknown): PostUpdate =>
  Object.freeze(parseWithScope(postUpdateSchema, input, 'post update'));

export const parsePostPrivacy = (input: unknown): PostPrivacy => {
  const value = parseWithScope(postPrivacySchema, input, 'privacy');
  return Object.freeze({
    level: value.privacy,
    selectedUsers: requireSelection(
      value.privacy,
      value.selectedUsers,
      'privacy',
    ),
  });
};
