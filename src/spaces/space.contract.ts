import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import { boundedText, parseWithScope } from '../common/validation/parse';
import type { PostAuthorView } from '../posts/post.contract';

const httpsUrl = z.string().trim().url().startsWith('https://').max(2048);

export interface SpaceCreate {
  readonly title: string;
}

export interface HighlightEntry {
  readonly videoUrl: string;
}

export interface SpaceView {
  readonly id: string;
  readonly title: string;
  readonly hostId: string;
  readonly host: PostAuthorView | null;
  readonly participants: JsonValue;
  readonly highlights: JsonValue;
  readonly isLive: boolean;
  readonly createdAt: string;
}

const spaceCreateSchema = z.object({ title: boundedText(200) }).strict();

const highlightEntrySchema = z.object({ videoUrl: httpsUrl }).strict();

export const parseSpaceCreate = (input: unknown): SpaceCreate =>
  Object.freeze(parseWithScope(spaceCreateSchema, input, 'title'));

export const parseHighlightEntry = (input: unknown): HighlightEntry =>
  Object.freeze(parseWithScope(highlightEntrySchema, input, 'videoUrl'));
