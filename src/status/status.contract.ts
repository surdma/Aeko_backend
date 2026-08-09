import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import { boundedText, parseWithScope } from '../common/validation/parse';
import type { PostAuthorView } from '../posts/post.contract';

export const STATUS_TYPES = ['text', 'image', 'video'] as const;
export type StatusType = (typeof STATUS_TYPES)[number];

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
  readonly userId: string;
  readonly user: PostAuthorView | null;
  readonly type: StatusType;
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
