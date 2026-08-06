import { Inject, Injectable } from '@nestjs/common';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import type { JoinWaitlistInput } from './join-waitlist.pipe.js';
import {
  WAITLIST_REPOSITORY,
  type WaitlistEntryRecord,
  type WaitlistRepository,
} from './waitlist.repository.js';

export type JoinWaitlistResult =
  | { readonly kind: 'created'; readonly entry: WaitlistEntryRecord }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'database-unavailable' }
  | { readonly kind: 'unexpected' };

@Injectable()
export class WaitlistService {
  public constructor(
    @Inject(WAITLIST_REPOSITORY) private readonly repository: WaitlistRepository,
    private readonly logger: SanitizedLogger,
  ) {}

  public async join(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
    try {
      const existing = await this.repository.findByEmail(input.email);
      if (existing.kind === 'found') return { kind: 'duplicate' };
      if (existing.kind === 'database-unavailable') return { kind: 'database-unavailable' };

      const created = await this.repository.create(input);
      if (created.kind === 'created') return created;
      return created;
    } catch (error: unknown) {
      this.logger.error('Waitlist signup failed', { error });
      return { kind: 'unexpected' };
    }
  }
}
