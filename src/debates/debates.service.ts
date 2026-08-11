import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { asJsonObject, asStringArray } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import { DebateScoringPort } from '../providers/debate-scoring/debate-scoring.port';
import {
  parseDebateCreate,
  parseDebateEnd,
  parseDebateScoreRequest,
  parseDebateVote,
  type DebateListQuery,
  type DebatePage,
  type DebateView,
} from './debate.contract';
import {
  createDebatePrismaClient,
  type DebatePrismaClient,
  type DebateRecord,
} from './debate-prisma.client';

@Injectable()
export class DebatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: DebateScoringPort,
  ) {}

  private get debates(): DebatePrismaClient {
    return createDebatePrismaClient(this.prisma.db);
  }

  async start(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<{ readonly success: true; readonly debate: DebateView }> {
    const input = parseDebateCreate(body);
    const record = await this.debates.create({
      topic: input.topic,
      participants: Object.freeze([...input.participants]),
      creatorId: principal.userId,
      scores: Object.freeze({}),
      votes: Object.freeze({}),
      status: 'active',
    });
    return Object.freeze({
      success: true as const,
      debate: await this.project(record),
    });
  }

  /**
   * Legacy let any authenticated user drive the AI scorer against any debate
   * and overwrite a participant's score. Scoring is now the creator's or an
   * administrator's.
   */
  async score(
    principal: AuthenticatedPrincipal,
    debateId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly score: number }> {
    const request = parseDebateScoreRequest(body);
    const existing = await this.debates.findById(debateId);
    if (existing === null) throw notFound();
    requireCreatorOrAdmin(principal, existing.creatorId);

    const scored = await this.scoring.score({
      debateId,
      participantId: request.participantId,
      message: request.message,
    });

    return this.debates.runSerializable(async (transaction) => {
      const record = await transaction.findById(debateId);
      if (record === null) throw notFound();
      await transaction.update(debateId, {
        scores: Object.freeze({
          ...asJsonObject(record.scores),
          [request.participantId]: scored.value,
        }),
      });
      return Object.freeze({ success: true as const, score: scored.value });
    });
  }

  /**
   * The stored shape is a counts map with no voter identity, so a repeat vote
   * still counts — see `correction:debate-vote-ballot-stuffing`, which is
   * pending a `DebateVote` table. What is fixed here is the lost update: the
   * increment is read and written inside one serializable transaction.
   */
  async vote(
    principal: AuthenticatedPrincipal,
    debateId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    void principal;
    const vote = parseDebateVote(body);
    return this.debates.runSerializable(async (transaction) => {
      const record = await transaction.findById(debateId);
      if (record === null) throw notFound();
      const votes = asJsonObject(record.votes);
      const current = votes[vote.participantId];
      const next = (typeof current === 'number' ? current : 0) + 1;
      await transaction.update(debateId, {
        votes: Object.freeze({ ...votes, [vote.participantId]: next }),
      });
      return Object.freeze({
        success: true as const,
        message: 'Vote added',
      });
    });
  }

  async end(
    principal: AuthenticatedPrincipal,
    debateId: string,
    body: unknown,
  ): Promise<{
    readonly success: true;
    readonly message: string;
    readonly debate: DebateView;
  }> {
    const decision = parseDebateEnd(body);
    const existing = await this.debates.findById(debateId);
    if (existing === null) throw notFound();
    requireCreatorOrAdmin(principal, existing.creatorId);

    const updated = await this.debates.update(debateId, {
      status: 'ended',
      endedAt: new Date(),
      winner: decision.winner,
      endReason: decision.reason,
    });
    return Object.freeze({
      success: true as const,
      message: 'Debate ended successfully',
      debate: await this.project(updated),
    });
  }

  /** Public, as in Express: this route never required a session. */
  async list(query: DebateListQuery): Promise<DebatePage> {
    const [records, total] = await Promise.all([
      this.debates.findMany(
        query.status,
        (query.page - 1) * query.limit,
        query.limit,
      ),
      this.debates.count(query.status),
    ]);

    // One lookup for the whole page rather than one per debate.
    const ids = [
      ...new Set(
        records.flatMap((record) => asStringArray(record.participants)),
      ),
    ];
    const people = await this.debates.findParticipants(ids);
    const byId = new Map(people.map((person) => [person.id, person]));

    return Object.freeze({
      debates: Object.freeze(
        records.map((record) => projectDebate(record, byId)),
      ),
      pagination: Object.freeze({
        current: query.page,
        pages: Math.ceil(total / query.limit),
        total,
        limit: query.limit,
      }),
    });
  }

  private async project(record: DebateRecord): Promise<DebateView> {
    const ids = asStringArray(record.participants);
    const people = await this.debates.findParticipants(ids);
    return projectDebate(record, new Map(people.map((p) => [p.id, p])));
  }
}

function requireCreatorOrAdmin(
  principal: AuthenticatedPrincipal,
  creatorId: string,
): void {
  if (principal.userId === creatorId || principal.isAdmin) return;
  throw new DomainError(
    'AUTHORIZATION_DENIED',
    'You do not have access to this debate.',
  );
}

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Debate not found.');
}

const projectDebate = (
  record: DebateRecord,
  people: ReadonlyMap<
    string,
    { id: string; username: string; profilePicture: string | null }
  >,
): DebateView =>
  Object.freeze({
    id: record.id,
    topic: record.topic,
    creatorId: record.creatorId,
    creator: record.creator,
    // A stored id with no live user is dropped, as the legacy join did.
    participants: Object.freeze(
      asStringArray(record.participants).flatMap((id) => {
        const person = people.get(id);
        return person === undefined ? [] : [Object.freeze({ ...person })];
      }),
    ),
    scores: record.scores,
    votes: record.votes,
    status: record.status,
    winner: record.winner,
    endReason: record.endReason,
    endedAt: record.endedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
