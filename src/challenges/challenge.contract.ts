import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';
import type { PostAuthorView } from '../posts/post.contract';

const httpsUrl = z.string().trim().url().startsWith('https://').max(2048);

export interface ChallengeCreate {
  readonly videoUrl: string;
}

export interface DuetEntry {
  readonly videoUrl: string;
}

/**
 * Voting carries no meaningful body. Legacy read the voter from
 * `req.body.userId`, which let any caller vote as anyone; the voter is now
 * always the authenticated principal and any supplied identity is stripped, so
 * a client that still sends one keeps working — voting as itself.
 */
export type ChallengeVote = Record<string, never>;

export interface ChallengeEnd {
  readonly winner: string | null;
  readonly reason: string;
}

export interface ChallengeListQuery {
  readonly status: string | null;
  readonly page: number;
  readonly limit: number;
}

export interface ChallengeParticipantView {
  readonly user: PostAuthorView | string;
  readonly videoUrl: string | null;
}

export interface ChallengeView {
  readonly id: string;
  readonly creatorId: string;
  readonly creator: PostAuthorView | null;
  readonly videoUrl: string;
  readonly participants: readonly ChallengeParticipantView[];
  readonly votes: JsonValue;
  readonly votesCount: number;
  readonly status: string;
  readonly winner: string | null;
  readonly endReason: string | null;
  readonly endedAt: string | null;
  readonly createdAt: string;
}

export interface ChallengePage {
  readonly challenges: readonly ChallengeView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
    limit: number;
  }>;
}

const challengeCreateSchema = z.object({ videoUrl: httpsUrl }).strict();

const duetEntrySchema = z.object({ videoUrl: httpsUrl }).strict();

const challengeVoteSchema = z.object({}).strip();

const challengeEndSchema = z
  .object({
    winner: boundedText(200).nullable().default(null),
    reason: boundedText(1_000).default('Ended by creator'),
  })
  .strict();

const challengeListQuerySchema = z
  .object({
    status: boundedText(50).nullable().default(null),
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(10, 50).default(10),
  })
  .strip();

export const parseChallengeCreate = (input: unknown): ChallengeCreate =>
  Object.freeze(parseWithScope(challengeCreateSchema, input, 'videoUrl'));

export const parseDuetEntry = (input: unknown): DuetEntry =>
  Object.freeze(parseWithScope(duetEntrySchema, input, 'videoUrl'));

export const parseChallengeVote = (input: unknown): ChallengeVote =>
  Object.freeze(parseWithScope(challengeVoteSchema, input, 'vote'));

export const parseChallengeEnd = (input: unknown): ChallengeEnd =>
  Object.freeze(parseWithScope(challengeEndSchema, input, 'challenge end'));

export const parseChallengeListQuery = (input: unknown): ChallengeListQuery =>
  Object.freeze(
    parseWithScope(challengeListQuerySchema, input, 'challenge query'),
  );
