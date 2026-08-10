import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';
import type { PostAuthorView } from '../posts/post.contract';

/** Upper bound on a debate roster; legacy accepted any size. */
export const MAX_PARTICIPANTS = 200;

export interface DebateCreate {
  readonly topic: string;
  readonly participants: readonly string[];
}

export interface DebateScoreRequest {
  readonly participantId: string;
  readonly message: string;
}

export interface DebateVote {
  readonly participantId: string;
}

export interface DebateEnd {
  readonly winner: string | null;
  readonly reason: string;
}

export interface DebateListQuery {
  readonly status: string | null;
  readonly page: number;
  readonly limit: number;
}

export interface DebateParticipantView {
  readonly id: string;
  readonly username: string;
  readonly profilePicture: string | null;
}

export interface DebateView {
  readonly id: string;
  readonly topic: string;
  readonly creatorId: string;
  readonly creator: PostAuthorView | null;
  /** Resolved user summaries when the stored ids match live users. */
  readonly participants: readonly DebateParticipantView[];
  readonly scores: JsonValue;
  readonly votes: JsonValue;
  readonly status: string;
  readonly winner: string | null;
  readonly endReason: string | null;
  readonly endedAt: string | null;
  readonly createdAt: string;
}

export interface DebatePage {
  readonly debates: readonly DebateView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
    limit: number;
  }>;
}

const participantIds = z
  .array(boundedText(200))
  .max(MAX_PARTICIPANTS)
  .default([]);

const debateCreateSchema = z
  .object({ topic: boundedText(500), participants: participantIds })
  .strict();

const debateScoreSchema = z
  .object({ participantId: boundedText(200), message: boundedText(5_000) })
  .strict();

/**
 * Only the participant being voted for is read. The voter is always the
 * authenticated principal, so a caller-supplied identity is stripped rather
 * than rejected: a client that still sends one keeps working, as itself.
 */
const debateVoteSchema = z.object({ participantId: boundedText(200) }).strip();

/** Legacy stored `reason || 'Ended by creator'` and a possibly absent winner. */
const debateEndSchema = z
  .object({
    winner: boundedText(200).nullable().default(null),
    reason: boundedText(1_000).default('Ended by creator'),
  })
  .strict();

const debateListQuerySchema = z
  .object({
    status: boundedText(50).nullable().default(null),
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(10, 50).default(10),
  })
  .strip();

export const parseDebateCreate = (input: unknown): DebateCreate =>
  Object.freeze(parseWithScope(debateCreateSchema, input, 'debate'));

export const parseDebateScoreRequest = (input: unknown): DebateScoreRequest =>
  Object.freeze(parseWithScope(debateScoreSchema, input, 'score request'));

export const parseDebateVote = (input: unknown): DebateVote =>
  Object.freeze(parseWithScope(debateVoteSchema, input, 'vote'));

export const parseDebateEnd = (input: unknown): DebateEnd =>
  Object.freeze(parseWithScope(debateEndSchema, input, 'debate end'));

export const parseDebateListQuery = (input: unknown): DebateListQuery =>
  Object.freeze(parseWithScope(debateListQuerySchema, input, 'debate query'));
