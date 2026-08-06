export interface InterestRecord {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateInterestInput {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly icon: string;
}

export interface UpdateInterestInput {
  readonly displayName?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly isActive?: boolean;
}

export interface UserInterestState {
  readonly interestIds: readonly string[];
  readonly profileCompletion: Readonly<Record<string, unknown>>;
}

export type CreateInterestPersistenceResult =
  | { readonly kind: 'created'; readonly interest: InterestRecord }
  | { readonly kind: 'duplicate' };

export interface InterestsRepository {
  listActive(): Promise<readonly InterestRecord[]>;
  listActiveByIds(ids: readonly string[]): Promise<readonly InterestRecord[]>;
  findById(id: string): Promise<InterestRecord | null>;
  create(input: CreateInterestInput): Promise<CreateInterestPersistenceResult>;
  update(id: string, input: UpdateInterestInput): Promise<InterestRecord>;
  delete(id: string): Promise<boolean>;
  findUserState(userId: string): Promise<UserInterestState | null>;
  updateUserInterestIds(
    userId: string,
    interestIds: readonly string[],
    profileCompletion?: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export const INTERESTS_REPOSITORY = Symbol('INTERESTS_REPOSITORY');
