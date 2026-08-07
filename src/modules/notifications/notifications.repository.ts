export interface NotificationSenderRecord {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly profilePicture: string | null;
  readonly blueTick: boolean;
}

export interface NotificationRecord {
  readonly id: string;
  readonly recipientId: string;
  readonly senderId: string | null;
  readonly type: string;
  readonly title: string | null;
  readonly message: string | null;
  readonly entityId: string | null;
  readonly entityType: string | null;
  readonly read: boolean;
  readonly metadata: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NotificationWithSenderRecord extends NotificationRecord {
  readonly sender: NotificationSenderRecord | null;
}

export interface UserNotificationSettingsRecord {
  readonly notificationSettings: unknown;
}

export interface NotificationListFilter {
  readonly userId: string;
  readonly page: number;
  readonly limit: number;
  readonly type?: string;
}

export interface NotificationPage {
  readonly notifications: readonly NotificationWithSenderRecord[];
  readonly total: number;
}

export interface NotificationsRepository {
  findUserSettings(userId: string): Promise<UserNotificationSettingsRecord | null>;
  updateUserSettings(userId: string, settings: unknown): Promise<unknown>;
  updatePushToken(userId: string, pushToken: string): Promise<void>;
  listNotifications(filter: NotificationListFilter): Promise<NotificationPage>;
  countUnread(userId: string): Promise<number>;
  findById(id: string): Promise<NotificationRecord | null>;
  markRead(id: string): Promise<NotificationRecord>;
  markAllRead(userId: string): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export const NOTIFICATIONS_REPOSITORY = Symbol('NOTIFICATIONS_REPOSITORY');
