export interface WaitlistEntryRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date;
}

export interface CreateWaitlistEntryInput {
  readonly name: string;
  readonly email: string;
}

export type FindWaitlistEntryResult =
  | { readonly kind: 'found'; readonly entry: WaitlistEntryRecord }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'database-unavailable' };

export type CreateWaitlistEntryResult =
  | { readonly kind: 'created'; readonly entry: WaitlistEntryRecord }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'database-unavailable' };

export interface WaitlistRepository {
  findByEmail(email: string): Promise<FindWaitlistEntryResult>;
  create(input: CreateWaitlistEntryInput): Promise<CreateWaitlistEntryResult>;
}

export const WAITLIST_REPOSITORY = Symbol('WAITLIST_REPOSITORY');
