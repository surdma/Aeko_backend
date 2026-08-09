import { isJsonObject, type JsonValue } from '../common/json/json-value';
import { POST_TYPES, type PostType, type PostView } from './post.contract';
import type { PostRecord } from './post-prisma.client';
import { readPostVisibility } from './visibility.policy';

interface MediaProjection {
  readonly mediaUrl: string | null;
  readonly mediaUrls: readonly string[];
}

/**
 * `media` has accumulated four historical shapes: a single string, an array of
 * strings, an array of `{ url }` objects, and a bare `{ url }` object. All four
 * are read so old rows keep rendering.
 */
export const readMedia = (media: JsonValue): MediaProjection => {
  if (typeof media === 'string') {
    return media.length > 0
      ? { mediaUrl: media, mediaUrls: Object.freeze([media]) }
      : { mediaUrl: null, mediaUrls: Object.freeze([]) };
  }
  if (Array.isArray(media)) {
    const urls = media.flatMap((entry: JsonValue) => {
      if (typeof entry === 'string') return [entry];
      if (isJsonObject(entry)) {
        const url = entry.url;
        return typeof url === 'string' ? [url] : [];
      }
      return [];
    });
    return {
      mediaUrl: urls[0] ?? null,
      mediaUrls: Object.freeze(urls),
    };
  }
  if (isJsonObject(media)) {
    const url = media.url;
    if (typeof url === 'string') {
      return { mediaUrl: url, mediaUrls: Object.freeze([url]) };
    }
    const found = Object.values(media).find(
      (value): value is string =>
        typeof value === 'string' &&
        (value.startsWith('http') || value.startsWith('/')),
    );
    return found === undefined
      ? { mediaUrl: null, mediaUrls: Object.freeze([]) }
      : { mediaUrl: found, mediaUrls: Object.freeze([found]) };
  }
  return { mediaUrl: null, mediaUrls: Object.freeze([]) };
};

const likeIds = (likes: JsonValue): readonly string[] =>
  Array.isArray(likes)
    ? likes.filter((entry): entry is string => typeof entry === 'string')
    : [];

const readType = (value: string): PostType =>
  POST_TYPES.find((candidate) => candidate === value) ?? 'text';

export const projectPost = (
  record: PostRecord,
  viewerId: string | null,
): PostView => {
  const { mediaUrl, mediaUrls } = readMedia(record.media);
  const likes = likeIds(record.likes);
  const type = readType(record.type);
  return Object.freeze({
    id: record.id,
    text: record.text,
    // Legacy downgrades a media post with no usable media to text.
    type:
      (type === 'image' || type === 'video') && mediaUrl === null
        ? 'text'
        : type,
    userId: record.userId,
    user: record.author,
    media: mediaUrls.length > 1 ? mediaUrls : mediaUrl,
    mediaUrl,
    mediaUrls,
    privacy: readPostVisibility(record.privacy),
    views: record.views,
    likesCount: likes.length,
    commentsCount: record.commentsCount,
    isLiked: viewerId !== null && likes.includes(viewerId),
    isAnchored: record.isAnchored,
    nftTokenId: record.nftTokenId,
    originalPostId: record.originalPostId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
};
