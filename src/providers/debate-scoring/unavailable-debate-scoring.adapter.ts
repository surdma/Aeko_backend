import { Injectable } from '@nestjs/common';

import { DomainError } from '../../common/errors/domain.error';
import {
  DebateScoringPort,
  type DebateScore,
  type DebateScoreRequest,
} from './debate-scoring.port';

/**
 * Placeholder scorer installed until the `chat-realtime` domain lands its bot.
 *
 * It reports the capability as unavailable rather than inventing a score:
 * a fabricated number would be written to `scores` and be indistinguishable
 * from a real verdict once the real adapter arrives.
 */
@Injectable()
export class UnavailableDebateScoringAdapter extends DebateScoringPort {
  score(request: DebateScoreRequest): Promise<DebateScore> {
    void request;
    return Promise.reject(
      new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Debate scoring is not available yet.',
      ),
    );
  }
}
