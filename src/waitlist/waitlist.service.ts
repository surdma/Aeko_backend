import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type WaitlistEntry } from '@prisma/client';
import { SanitizedLogger } from '../common/sanitized-logger.js';
import type { JoinWaitlistInput } from './join-waitlist.pipe.js';
import {
  WAITLIST_REPOSITORY,
  type WaitlistRepository,
} from './waitlist.repository.js';

export type JoinWaitlistResult =
  | { readonly kind: 'created'; readonly entry: WaitlistEntry }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'database-unavailable' }
  | { readonly kind: 'unexpected' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function isDuplicateEmailError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isDatabaseUnavailableError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    /Can't reach database server/iu.test(errorMessage(error))
  );
}

@Injectable()
export class WaitlistService {
  public constructor(
    @Inject(WAITLIST_REPOSITORY)
    private readonly repository: WaitlistRepository,
    private readonly logger: SanitizedLogger,
  ) {}

  public async join(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
    try {
      const existingEntry = await this.repository.findByEmail(input.email);
      if (existingEntry !== null) {
        return { kind: 'duplicate' };
      }

      const entry = await this.repository.create(input);
      return { kind: 'created', entry };
    } catch (error: unknown) {
      if (isDuplicateEmailError(error)) {
        return { kind: 'duplicate' };
      }

      if (isDatabaseUnavailableError(error)) {
        return { kind: 'database-unavailable' };
      }

      this.logger.error('Waitlist signup failed', { error });
      return { kind: 'unexpected' };
    }
  }
}
