import { Inject, Injectable } from '@nestjs/common';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import type {
  CreateInterestBody,
  UpdateInterestBody,
} from './interest.schemas.js';
import {
  INTERESTS_REPOSITORY,
  type InterestRecord,
  type InterestsRepository,
  type UpdateInterestInput,
} from './interests.repository.js';

export type InterestsResult =
  | { readonly kind: 'success'; readonly data: readonly InterestRecord[] }
  | { readonly kind: 'unexpected' };

export type InterestResult =
  | { readonly kind: 'success'; readonly data: InterestRecord }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unexpected' };

export type DeleteInterestResult =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unexpected' };

export type UserInterestsResult =
  | { readonly kind: 'success'; readonly data: readonly InterestRecord[] }
  | { readonly kind: 'user-not-found' }
  | { readonly kind: 'invalid-interest-ids' }
  | { readonly kind: 'interest-not-found' }
  | { readonly kind: 'unexpected' };

@Injectable()
export class InterestsService {
  public constructor(
    @Inject(INTERESTS_REPOSITORY)
    private readonly repository: InterestsRepository,
    private readonly logger: SanitizedLogger,
  ) {}

  public async listActive(): Promise<InterestsResult> {
    try {
      return { kind: 'success', data: await this.repository.listActive() };
    } catch (error: unknown) {
      return this.unexpected('fetch interests', error);
    }
  }

  public async create(input: CreateInterestBody): Promise<InterestResult> {
    try {
      const result = await this.repository.create({
        name: input.name.toLowerCase(),
        displayName: input.displayName,
        description: input.description,
        icon: input.icon,
      });

      return result.kind === 'duplicate'
        ? { kind: 'duplicate' }
        : { kind: 'success', data: result.interest };
    } catch (error: unknown) {
      return this.unexpected('create interest', error);
    }
  }

  public async update(
    id: string,
    input: UpdateInterestBody,
  ): Promise<InterestResult> {
    try {
      if ((await this.repository.findById(id)) === null) {
        return { kind: 'not-found' };
      }

      const changes: UpdateInterestInput = {
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.isActive === undefined
          ? {}
          : { isActive: input.isActive }),
      };

      return {
        kind: 'success',
        data: await this.repository.update(id, changes),
      };
    } catch (error: unknown) {
      return this.unexpected('update interest', error);
    }
  }

  public async delete(id: string): Promise<DeleteInterestResult> {
    try {
      return (await this.repository.delete(id))
        ? { kind: 'deleted' }
        : { kind: 'not-found' };
    } catch (error: unknown) {
      this.logger.error('Failed to delete interest', { error });
      return { kind: 'unexpected' };
    }
  }

  public async listForUser(userId: string): Promise<UserInterestsResult> {
    try {
      const state = await this.repository.findUserState(userId);
      if (state === null) return { kind: 'user-not-found' };

      const data =
        state.interestIds.length === 0
          ? []
          : await this.repository.listActiveByIds(state.interestIds);
      return { kind: 'success', data };
    } catch (error: unknown) {
      return this.unexpectedUser('fetch user interests', error);
    }
  }

  public async addForUser(
    userId: string,
    requestedIds: readonly string[],
  ): Promise<UserInterestsResult> {
    try {
      const validInterests = await this.repository.listActiveByIds(requestedIds);
      if (validInterests.length !== requestedIds.length) {
        return { kind: 'invalid-interest-ids' };
      }

      const state = await this.repository.findUserState(userId);
      if (state === null) return { kind: 'user-not-found' };

      const mergedIds = [...new Set([...state.interestIds, ...requestedIds])];
      await this.repository.updateUserInterestIds(userId, mergedIds, {
        ...state.profileCompletion,
        interestsSelected: true,
      });

      return {
        kind: 'success',
        data: await this.repository.listActiveByIds(mergedIds),
      };
    } catch (error: unknown) {
      return this.unexpectedUser('update user interests', error);
    }
  }

  public async removeForUser(
    userId: string,
    interestId: string,
  ): Promise<UserInterestsResult> {
    try {
      const state = await this.repository.findUserState(userId);
      if (state === null) return { kind: 'user-not-found' };
      if (!state.interestIds.includes(interestId)) {
        return { kind: 'interest-not-found' };
      }

      const updatedIds = state.interestIds.filter((id) => id !== interestId);
      await this.repository.updateUserInterestIds(userId, updatedIds);
      return {
        kind: 'success',
        data: await this.repository.listActiveByIds(updatedIds),
      };
    } catch (error: unknown) {
      return this.unexpectedUser('remove user interest', error);
    }
  }

  private unexpected(
    operation: string,
    error: unknown,
  ): { readonly kind: 'unexpected' } {
    this.logger.error(`Failed to ${operation}`, { error });
    return { kind: 'unexpected' };
  }

  private unexpectedUser(
    operation: string,
    error: unknown,
  ): { readonly kind: 'unexpected' } {
    this.logger.error(`Failed to ${operation}`, { error });
    return { kind: 'unexpected' };
  }
}
