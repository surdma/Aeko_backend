import {
  asJsonObject,
  asStringArray,
  type JsonValue,
} from '../common/json/json-value';
import {
  PRIVACY_LEVELS,
  type PostPrivacy,
  type PostPrivacyLevel,
} from './post.contract';

export interface ViewerContext {
  readonly viewerId: string | null;
  readonly isOwner: boolean;
  readonly isFollower: boolean;
  readonly isBlocked: boolean;
}

/**
 * Stored privacy is a free-form JSON column that predates any schema, so it is
 * read tolerantly: absent or malformed values mean the legacy default, public.
 */
export const readPostVisibility = (
  value: JsonValue | undefined,
): PostPrivacy => {
  const record = asJsonObject(value);
  const level = PRIVACY_LEVELS.find((candidate) => candidate === record.level);
  return Object.freeze({
    level: level ?? 'public',
    selectedUsers: Object.freeze(asStringArray(record.selectedUsers)),
  });
};

/**
 * The single visibility decision for every post read. Blocking is evaluated
 * before ownership: a blocked author's post is never shown, which the Express
 * feed enforced in its where-clause but the single-post read did not.
 */
export const canViewPost = (
  privacy: PostPrivacy,
  viewer: ViewerContext,
): boolean => {
  if (viewer.isBlocked) return false;
  if (viewer.isOwner) return true;
  return allows(privacy, viewer);
};

const allows = (privacy: PostPrivacy, viewer: ViewerContext): boolean => {
  const level: PostPrivacyLevel = privacy.level;
  switch (level) {
    case 'public':
      return true;
    case 'followers':
      return viewer.isFollower;
    case 'select_users':
      return (
        viewer.viewerId !== null &&
        privacy.selectedUsers.includes(viewer.viewerId)
      );
    case 'only_me':
      return false;
  }
};
