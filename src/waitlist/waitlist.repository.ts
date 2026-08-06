import type { WaitlistEntry } from '@prisma/client';

export interface CreateWaitlistEntryInput {
  readonly name: string;
  readonly email: string;
}

export interface WaitlistRepository {
  findByEmail(email: string): Promise<WaitlistEntry | null>;
  create(input: CreateWaitlistEntryInput): Promise<WaitlistEntry>;
}

export const WAITLIST_REPOSITORY = Symbol('WAITLIST_REPOSITORY');
