import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';
import type { PostAuthorView } from '../posts/post.contract';

export interface CommentCreate {
  readonly text: string;
}

export interface CommentListQuery {
  readonly page: number;
  readonly limit: number;
}

export interface CommentView {
  readonly id: string;
  readonly text: string;
  readonly postId: string;
  readonly userId: string;
  readonly user: PostAuthorView | null;
  readonly parentId: string | null;
  readonly likes: JsonValue;
  readonly likesCount: number;
  readonly isLiked: boolean;
  readonly repliesCount: number;
  readonly replies: readonly CommentView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommentPage {
  readonly comments: readonly CommentView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
  }>;
}

const MAX_PAGE_SIZE = 50;

const commentCreateSchema = z.object({ text: boundedText(5_000) }).strict();

const commentListQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(20, MAX_PAGE_SIZE).default(20),
  })
  .strip();

export const parseCommentCreate = (input: unknown): CommentCreate =>
  Object.freeze(parseWithScope(commentCreateSchema, input, 'comment'));

export const parseCommentListQuery = (input: unknown): CommentListQuery =>
  Object.freeze(parseWithScope(commentListQuerySchema, input, 'comment query'));
