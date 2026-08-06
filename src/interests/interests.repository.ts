import type { Interest } from '@prisma/client';

export interface InterestsRepository {
  listActive(): Promise<readonly Interest[]>;
}

export const INTERESTS_REPOSITORY = Symbol('INTERESTS_REPOSITORY');
