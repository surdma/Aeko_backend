import { Inject, Injectable } from '@nestjs/common';
import type { Interest } from '@prisma/client';
import { SanitizedLogger } from '../common/sanitized-logger.js';
import {
  INTERESTS_REPOSITORY,
  type InterestsRepository,
} from './interests.repository.js';

export type ListActiveInterestsResult =
  | { readonly kind: 'loaded'; readonly interests: readonly Interest[] }
  | { readonly kind: 'unexpected' };

@Injectable()
export class InterestsService {
  public constructor(
    @Inject(INTERESTS_REPOSITORY)
    private readonly repository: InterestsRepository,
    private readonly logger: SanitizedLogger,
  ) {}

  public async listActive(): Promise<ListActiveInterestsResult> {
    try {
      return {
        kind: 'loaded',
        interests: await this.repository.listActive(),
      };
    } catch (error: unknown) {
      this.logger.error('Active interests query failed', { error });
      return { kind: 'unexpected' };
    }
  }
}
