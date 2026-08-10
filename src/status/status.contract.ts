import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';
import type { PostAuthorView } from '../posts/post.contract';

export const STATUS_TYPES = ['text', 'image', 'video'] as const;
export type StatusType = (typeof STATUS_TYPES)[number];

/**
 * A reshare is persisted as `shared_post`. It is not creatable through the
 * create contract, but it is readable, so the view type is wider than the
 * create type.
 */
export const SHARED_STATUS_TYPE = 'shared_post';
export type StatusViewType = StatusType | typeof SHARED_STATUS_TYPE;

export interface StatusCreate {
  readonly type: StatusType;
  readonly content: string;
  readonly caption: string | null;
  readonly backgroundColor: string | null;
  readonly font: string | null;
}

export interface StatusReaction {
  readonly emoji: string;
}

export interface StatusView {
  readonly id: string;
  /** Legacy shaped every listed status with these two fields. */
  readonly displayContent: StatusDisplayContent;
  readonly sharedPostData: SharedPostData | null;
  readonly userId: string;
  readonly user: PostAuthorView | null;
  readonly type: StatusViewType;
  readonly content: string;
  readonly caption: string | null;
  readonly backgroundColor: string | null;
  readonly font: string | null;
  readonly reactions: JsonValue;
  readonly reactionsCount: number;
  readonly sharedPostId: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
}

const statusCreateSchema = z
  .object({
    type: z.enum(STATUS_TYPES).default('text'),
    content: boundedText(5_000),
    // Legacy normalizes `description` onto `caption`.
    caption: boundedText(1_000).nullable().default(null),
    description: boundedText(1_000).nullable().default(null),
    backgroundColor: boundedText(50).nullable().default(null),
    font: boundedText(100).nullable().default(null),
  })
  .strict();

const statusReactionSchema = z.object({ emoji: boundedText(16) }).strict();

export const parseStatusCreate = (input: unknown): StatusCreate => {
  const value = parseWithScope(statusCreateSchema, input, 'status');
  return Object.freeze({
    type: value.type,
    content: value.content,
    caption: value.caption ?? value.description,
    backgroundColor: value.backgroundColor,
    font: value.font,
  });
};

export const parseStatusReaction = (input: unknown): StatusReaction =>
  Object.freeze(parseWithScope(statusReactionSchema, input, 'emoji'));

export interface StatusListQuery {
  readonly page: number;
  readonly limit: number;
}

export interface StatusReshare {
  readonly caption: string | null;
  readonly backgroundColor: string | null;
  readonly font: string | null;
}

export interface StatusDisplayContent {
  readonly type: string;
  readonly content?: string;
  readonly caption: string | null;
  readonly backgroundColor: string | null;
  readonly font: string | null;
  readonly originalCreator?: JsonValue;
  readonly originalContent?: JsonValue;
  readonly originalMedia?: JsonValue;
  readonly originalType?: JsonValue;
  readonly sharedBy?: JsonValue;
  readonly additionalContent?: string;
}

export interface SharedPostData {
  readonly originalPost: Readonly<{
    content: JsonValue;
    media: JsonValue;
    type: JsonValue;
    creator: JsonValue;
    createdAt: JsonValue;
  }>;
  readonly shareInfo: Readonly<{
    sharedAt: JsonValue;
    sharedBy: JsonValue;
    additionalContent: string;
  }>;
}

const statusListQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(50, 100).default(50),
  })
  .strip();

const statusReshareSchema = z
  .object({
    caption: boundedText(1_000).nullable().default(null),
    backgroundColor: boundedText(50).nullable().default(null),
    font: boundedText(100).nullable().default(null),
  })
  .strict();

export const parseStatusListQuery = (input: unknown): StatusListQuery =>
  Object.freeze(parseWithScope(statusListQuerySchema, input, 'status query'));

export const parseStatusReshare = (input: unknown): StatusReshare =>
  Object.freeze(parseWithScope(statusReshareSchema, input, 'reshare'));
