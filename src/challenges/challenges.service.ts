import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { isJsonObject, type JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import type { PostAuthorView } from '../posts/post.contract';
import {
  parseChallengeCreate,
  parseChallengeEnd,
  parseChallengeVote,
  parseDuetEntry,
  type ChallengeListQuery,
  type ChallengePage,
  type ChallengeParticipantView,
  type ChallengeView,
} from './challenge.contract';
import {
  createChallengePrismaClient,
  type ChallengePrismaClient,
  type ChallengeRecord,
} from './challenge-prisma.client';

/**
 * A stored participant entry: `{ user: <userId>, videoUrl }`. Declared as a
 * JSON shape so it can be written straight back to the column.
 */
type StoredParticipant = {
  readonly [key: string]: JsonValue;
  readonly user: string;
  readonly videoUrl: string | null;
};

@Injectable()
export class ChallengesService {
  constructor(private readonly prisma: PrismaService) {}

  private get challenges(): ChallengePrismaClient {
    return createChallengePrismaClient(this.prisma.db);
  }

  async create(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<{ readonly success: true; readonly challenge: ChallengeView }> {
    const input = parseChallengeCreate(body);
    const record = await this.challenges.create({
      creatorId: principal.userId,
      videoUrl: input.videoUrl,
      participants: Object.freeze([]),
      votes: Object.freeze([]),
      status: 'active',
    });
    return Object.freeze({
      success: true as const,
      challenge: await this.project(record),
    });
  }

  async duet(
    principal: AuthenticatedPrincipal,
    challengeId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    const entry = parseDuetEntry(body);
    return this.challenges.runSerializable(async (transaction) => {
      const record = await transaction.findById(challengeId);
      if (record === null) throw notFound();
      const participants = readParticipants(record.participants);
      await transaction.update(challengeId, {
        participants: Object.freeze([
          ...participants,
          Object.freeze({ user: principal.userId, videoUrl: entry.videoUrl }),
        ]),
      });
      return Object.freeze({ success: true as const, message: 'Duet added' });
    });
  }

  /**
   * Legacy read the voter from `req.body.userId`, so any caller could vote as
   * anyone. The voter is now always the authenticated principal; a supplied
   * identity is ignored. The stored shape is an array of voter ids, so the
   * existing one-vote-per-voter rule is preserved and now enforced atomically.
   */
  async vote(
    principal: AuthenticatedPrincipal,
    challengeId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    parseChallengeVote(body);
    return this.challenges.runSerializable(async (transaction) => {
      const record = await transaction.findById(challengeId);
      if (record === null) throw notFound();
      const votes = readVoters(record.votes);
      if (!votes.includes(principal.userId)) {
        await transaction.update(challengeId, {
          votes: Object.freeze([...votes, principal.userId]),
        });
      }
      return Object.freeze({ success: true as const, message: 'Vote added' });
    });
  }

  async end(
    principal: AuthenticatedPrincipal,
    challengeId: string,
    body: unknown,
  ): Promise<{
    readonly success: true;
    readonly message: string;
    readonly challenge: ChallengeView;
  }> {
    const decision = parseChallengeEnd(body);
    const existing = await this.challenges.findById(challengeId);
    if (existing === null) throw notFound();
    if (existing.creatorId !== principal.userId && !principal.isAdmin) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'You do not have access to this challenge.',
      );
    }
    const updated = await this.challenges.update(challengeId, {
      status: 'ended',
      endedAt: new Date(),
      winner: decision.winner,
      endReason: decision.reason,
    });
    return Object.freeze({
      success: true as const,
      message: 'Challenge ended successfully',
      challenge: await this.project(updated),
    });
  }

  /** Public, as in Express: this listing never required a session. */
  async list(query: ChallengeListQuery): Promise<ChallengePage> {
    const [records, total] = await Promise.all([
      this.challenges.findMany(
        query.status,
        (query.page - 1) * query.limit,
        query.limit,
      ),
      this.challenges.count(query.status),
    ]);

    const ids = [
      ...new Set(
        records.flatMap((record) =>
          readParticipants(record.participants).map((entry) => entry.user),
        ),
      ),
    ];
    const people = await this.challenges.findParticipants(ids);
    const byId = new Map(
      people.flatMap((person) =>
        person.id === null ? [] : [[person.id, person] as const],
      ),
    );

    return Object.freeze({
      challenges: Object.freeze(
        records.map((record) => projectChallenge(record, byId)),
      ),
      pagination: Object.freeze({
        current: query.page,
        pages: Math.ceil(total / query.limit),
        total,
        limit: query.limit,
      }),
    });
  }

  private async project(record: ChallengeRecord): Promise<ChallengeView> {
    const ids = readParticipants(record.participants).map((e) => e.user);
    const people = await this.challenges.findParticipants(ids);
    return projectChallenge(
      record,
      new Map(
        people.flatMap((p) => (p.id === null ? [] : [[p.id, p] as const])),
      ),
    );
  }
}

const readParticipants = (value: JsonValue): readonly StoredParticipant[] => {
  const entries: readonly JsonValue[] = Array.isArray(value) ? value : [];
  return entries.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    const user = entry.user;
    if (typeof user !== 'string') return [];
    const videoUrl = entry.videoUrl;
    return [
      Object.freeze({
        user,
        videoUrl: typeof videoUrl === 'string' ? videoUrl : null,
      }),
    ];
  });
};

const readVoters = (value: JsonValue): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const projectChallenge = (
  record: ChallengeRecord,
  people: ReadonlyMap<string, PostAuthorView>,
): ChallengeView => {
  const votes = readVoters(record.votes);
  const participants: readonly ChallengeParticipantView[] = readParticipants(
    record.participants,
  ).map((entry) =>
    Object.freeze({
      // Legacy fell back to the raw id when the user was gone.
      user: people.get(entry.user) ?? entry.user,
      videoUrl: entry.videoUrl,
    }),
  );
  return Object.freeze({
    id: record.id,
    creatorId: record.creatorId,
    creator: record.creator,
    videoUrl: record.videoUrl,
    participants: Object.freeze(participants),
    votes: record.votes,
    votesCount: votes.length,
    status: record.status,
    winner: record.winner,
    endReason: record.endReason,
    endedAt: record.endedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
};

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Challenge not found.');
}
