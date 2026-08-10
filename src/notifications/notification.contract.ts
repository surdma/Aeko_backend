import { z } from 'zod';

import { toJsonValue, type JsonValue } from '../common/json/json-value';
import {
  boundedText,
  parseWithScope,
  queryInteger,
} from '../common/validation/parse';
import type { PostAuthorView } from '../posts/post.contract';

export interface NotificationSettings {
  readonly global: Readonly<{ pauseAll: boolean; quietMode: boolean }>;
  readonly interactions: Readonly<{
    likes: boolean;
    comments: boolean;
    mentions: boolean;
    tags: boolean;
  }>;
  readonly network: Readonly<{
    newFollowers: boolean;
    recommendations: boolean;
  }>;
}

export interface PushTokenUpdate {
  readonly pushToken: string;
}

export interface NotificationListQuery {
  readonly page: number;
  readonly limit: number;
  readonly unreadOnly: boolean;
  /** Legacy accepted `?type=` to filter the inbox by notification kind. */
  readonly type: string | null;
}

export interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly title: string | null;
  readonly message: string | null;
  readonly entityId: string | null;
  readonly entityType: string | null;
  readonly read: boolean;
  readonly metadata: JsonValue;
  readonly sender: PostAuthorView | null;
  readonly createdAt: string;
}

export interface NotificationPage {
  readonly notifications: readonly NotificationView[];
  readonly pagination: Readonly<{
    current: number;
    pages: number;
    total: number;
  }>;
}

/** The documented legacy defaults, applied when a user has never saved any. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings =
  Object.freeze({
    global: Object.freeze({ pauseAll: false, quietMode: false }),
    interactions: Object.freeze({
      likes: true,
      comments: true,
      mentions: true,
      tags: true,
    }),
    network: Object.freeze({ newFollowers: true, recommendations: true }),
  });

const settingsSchema = z
  .object({
    global: z
      .object({
        pauseAll: z.boolean().default(false),
        quietMode: z.boolean().default(false),
      })
      .strict()
      .optional(),
    interactions: z
      .object({
        likes: z.boolean().default(true),
        comments: z.boolean().default(true),
        mentions: z.boolean().default(true),
        tags: z.boolean().default(true),
      })
      .strict()
      .optional(),
    network: z
      .object({
        newFollowers: z.boolean().default(true),
        recommendations: z.boolean().default(true),
      })
      .strict()
      .optional(),
  })
  .strict();

const pushTokenSchema = z.object({ pushToken: boundedText(512) }).strict();

const listQuerySchema = z
  .object({
    page: queryInteger(1, 1_000_000).default(1),
    limit: queryInteger(20, 50).default(20),
    unreadOnly: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    type: boundedText(100).nullable().default(null),
  })
  .strip();

export const parseNotificationSettings = (
  input: unknown,
): NotificationSettings => {
  const value = parseWithScope(settingsSchema, input, 'settings');
  return Object.freeze({
    global: Object.freeze({
      ...DEFAULT_NOTIFICATION_SETTINGS.global,
      ...value.global,
    }),
    interactions: Object.freeze({
      ...DEFAULT_NOTIFICATION_SETTINGS.interactions,
      ...value.interactions,
    }),
    network: Object.freeze({
      ...DEFAULT_NOTIFICATION_SETTINGS.network,
      ...value.network,
    }),
  });
};

export const parsePushToken = (input: unknown): PushTokenUpdate =>
  Object.freeze(parseWithScope(pushTokenSchema, input, 'pushToken'));

export const parseNotificationListQuery = (
  input: unknown,
): NotificationListQuery =>
  Object.freeze(parseWithScope(listQuerySchema, input, 'notification query'));

/**
 * A notification as delivered over the realtime stream. It is the same shape
 * the REST inbox returns plus the recipient, so a subscriber can assert the
 * event is addressed to it.
 */
export interface NotificationEvent extends NotificationView {
  readonly recipientId: string;
}

const eventSchema = z
  .object({
    id: boundedText(200),
    recipientId: boundedText(200),
    type: boundedText(100),
    title: z.string().nullable(),
    message: z.string().nullable(),
    entityId: z.string().nullable(),
    entityType: z.string().nullable(),
    read: z.boolean(),
    metadata: z.unknown(),
    sender: z.unknown(),
    createdAt: z.string(),
  })
  .strip();

/**
 * Broker payloads are untrusted input like any other: a malformed or foreign
 * message is dropped rather than propagated to a subscriber.
 */
export const parseNotificationEvent = (
  payload: string,
): NotificationEvent | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  const result = eventSchema.safeParse(raw);
  if (!result.success) return null;
  const value = result.data;
  return Object.freeze({
    id: value.id,
    recipientId: value.recipientId,
    type: value.type,
    title: value.title,
    message: value.message,
    entityId: value.entityId,
    entityType: value.entityType,
    read: value.read,
    metadata: toJsonValue(value.metadata),
    sender: readAuthorView(value.sender),
    createdAt: value.createdAt,
  });
};

const readAuthorView = (value: unknown): PostAuthorView | null => {
  if (typeof value !== 'object' || value === null) return null;
  const read = (key: string): string | null => {
    const found: unknown = Reflect.get(value, key);
    return typeof found === 'string' ? found : null;
  };
  return Object.freeze({
    id: read('id'),
    name: read('name'),
    username: read('username'),
    profilePicture: read('profilePicture'),
    blueTick: Reflect.get(value, 'blueTick') === true,
    goldenTick: Reflect.get(value, 'goldenTick') === true,
  });
};
