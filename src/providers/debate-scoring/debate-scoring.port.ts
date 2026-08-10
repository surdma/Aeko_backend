/**
 * AI scoring for a debate contribution.
 *
 * The scorer is the conversational bot, whose capabilities belong to the
 * `chat-realtime` domain (programme order 7). Debates land first, so the route,
 * its authorization, contract, and persistence are migrated against this port
 * and the real adapter arrives with that domain. Until then the installed
 * adapter reports the capability as unavailable rather than inventing a score.
 */

export interface DebateScoreRequest {
  readonly debateId: string;
  readonly participantId: string;
  readonly message: string;
}

export interface DebateScore {
  /** The scorer's verdict for this contribution, as stored in `scores`. */
  readonly value: number;
  readonly rationale: string | null;
}

export abstract class DebateScoringPort {
  abstract score(request: DebateScoreRequest): Promise<DebateScore>;
}
