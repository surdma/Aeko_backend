import type {
  NotificationPage,
  NotificationRecord,
} from './notifications.repository.js';

export type NotificationSettingsResult =
  | { readonly kind: 'success'; readonly settings: unknown }
  | { readonly kind: 'unexpected' };

export type UpdatePushTokenResult =
  | { readonly kind: 'success' }
  | { readonly kind: 'missing-token' }
  | { readonly kind: 'unexpected' };

export type NotificationPageResult =
  | { readonly kind: 'success'; readonly page: NotificationPage }
  | { readonly kind: 'unexpected' };

export type UnreadCountResult =
  | { readonly kind: 'success'; readonly count: number }
  | { readonly kind: 'unexpected' };

export type NotificationMutationResult =
  | { readonly kind: 'success'; readonly notification: NotificationRecord }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unexpected' };

export type NotificationMessageResult =
  | { readonly kind: 'success' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unexpected' };
