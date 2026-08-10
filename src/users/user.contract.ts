import { z } from 'zod';

import type { UserModel } from '../generated/prisma/models/User';
import { DomainError } from '../common/errors/domain.error';
import type { PageMeta, PageQuery } from '../common/pagination/page-query';

export interface UserSearch {
  readonly search: string;
}

export interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly image: string | null;
  readonly avatar: string | null;
  readonly profilePicture: string | null;
  readonly coverPicture: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly blueTick: boolean;
  readonly goldenTick: boolean;
  readonly createdAt: string;
}

export interface UserView extends UserSummary {
  readonly isPrivate: boolean;
  readonly followersCount: number | null;
  readonly followingCount: number | null;
}

export interface UserPage {
  readonly items: readonly UserView[];
  readonly page: PageMeta;
}

export interface UserListQuery extends PageQuery, UserSearch {}

export type UserProjectionSource = Pick<
  UserModel,
  | 'id'
  | 'username'
  | 'name'
  | 'image'
  | 'avatar'
  | 'profilePicture'
  | 'coverPicture'
  | 'bio'
  | 'location'
  | 'blueTick'
  | 'goldenTick'
  | 'createdAt'
>;

const userSearchSchema = z.object({
  search: z.string().trim().default(''),
});

export const parseUserSearch = (input: unknown): UserSearch => {
  const result = userSearchSchema.safeParse(input);

  if (!result.success) {
    const fields = result.error.issues.map((issue) =>
      issue.path.length > 0 ? issue.path.join('.') : 'search',
    );
    throw new DomainError(
      'VALIDATION_FAILED',
      `Invalid user search: ${fields.join(', ')}`,
      { search: result.error.issues.map((issue) => issue.message) },
    );
  }

  return result.data;
};

export const projectUser = (user: UserProjectionSource): UserSummary => ({
  id: user.id,
  username: user.username,
  name: user.name,
  image: user.image ?? null,
  avatar: user.avatar ?? null,
  profilePicture: user.profilePicture ?? null,
  coverPicture: user.coverPicture ?? null,
  bio: user.bio ?? null,
  location: user.location ?? null,
  blueTick: user.blueTick,
  goldenTick: user.goldenTick,
  createdAt: user.createdAt.toISOString(),
});
