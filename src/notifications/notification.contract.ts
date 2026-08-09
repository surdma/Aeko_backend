import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
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
