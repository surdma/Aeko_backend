import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';

/** Legacy required at least ten characters of description. */
export const MIN_DESCRIPTION = 10;
export const MAX_TAGS = 50;

export interface CommunityCreate {
  readonly name: string;
  readonly description: string;
  readonly isPrivate: boolean;
  readonly tags: readonly string[];
}

export interface CommunityUpdate {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly isPrivate?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly settings?: Readonly<Record<string, JsonValue>> | undefined;
}

export interface CommunityListQuery {
  readonly page: number;
  readonly limit: number;
  readonly search: string | null;
}

export interface CommunityOwnerView {
  readonly name: string;
  readonly username: string;
  readonly profilePicture: string | null;
  readonly blueTick?: boolean;
  readonly goldenTick?: boolean;
}

export interface CommunityMemberView {
  readonly name: string;
  readonly username: string;
  readonly profilePicture: string | null;
}

export interface CommunityView {
  readonly id: string;
  /** Legacy answered with both `id` and a Mongo-era `_id` alias. */
  readonly _id: string;
  readonly name: string;
  readonly description: string | null;
  readonly ownerId: string | null;
  readonly owner: CommunityOwnerView | null;
  readonly isPrivate: boolean;
  readonly isActive: boolean;
  readonly memberCount: number;
  readonly tags: readonly string[];
  readonly profile: JsonValue;
  readonly settings: JsonValue;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommunityDetailView extends CommunityView {
  readonly members: readonly CommunityMemberView[];
  readonly moderators: readonly CommunityMemberView[];
}

export interface CommunityPage {
  readonly communities: readonly CommunityView[];
  readonly pagination: Readonly<{
    total: number;
    page: number;
    pages: number;
    limit: number;
  }>;
}

const tags = z.array(boundedText(100)).max(MAX_TAGS);

/**
 * `settings` is merged into the stored object rather than replacing it, so the
 * value must be an object. Legacy accepted any object and merged it shallowly.
 */
const settingsObject = z.record(
  z.string(),
  z.unknown(),
) as unknown as z.ZodType<Readonly<Record<string, JsonValue>>>;

const communityCreateSchema = z
  .object({
    name: boundedText(200),
    description: z.string().trim().min(MIN_DESCRIPTION).max(5_000),
    isPrivate: z.boolean().default(false),
    tags: tags.default([]),
  })
  .strip();

const communityUpdateSchema = z
  .object({
    name: boundedText(200).optional(),
    description: z.string().trim().min(MIN_DESCRIPTION).max(5_000).optional(),
    isPrivate: z.boolean().optional(),
    tags: tags.optional(),
    settings: settingsObject.optional(),
  })
  .strip();

/**
 * Legacy applied `parseInt` with no ceiling and defaulted the search term to
 * an empty string, which it then fed to three `contains` predicates. An absent
 * term is now `null` so the service can drop the filter entirely.
 */
const communityListQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(10, 100).default(10),
    search: boundedText(200).nullable().default(null),
  })
  .strip();

const myCommunitiesQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(20, 100).default(20),
    search: boundedText(200).nullable().default(null),
  })
  .strip();

export const parseCommunityCreate = (input: unknown): CommunityCreate =>
  Object.freeze(parseWithScope(communityCreateSchema, input, 'community'));

export const parseCommunityUpdate = (input: unknown): CommunityUpdate =>
  Object.freeze(parseWithScope(communityUpdateSchema, input, 'community'));

export const parseCommunityListQuery = (input: unknown): CommunityListQuery =>
  Object.freeze(
    parseWithScope(communityListQuerySchema, input, 'community query'),
  );

export const parseMyCommunitiesQuery = (input: unknown): CommunityListQuery =>
  Object.freeze(
    parseWithScope(myCommunitiesQuerySchema, input, 'community query'),
  );
