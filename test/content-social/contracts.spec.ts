import {
  parsePostCreate,
  parsePostListQuery,
  parsePostPrivacy,
  parsePostSearchQuery,
  parsePostUpdate,
} from '../../src/posts/post.contract';
import {
  canViewPost,
  readPostVisibility,
} from '../../src/posts/visibility.policy';
import {
  parseCommentCreate,
  parseCommentListQuery,
} from '../../src/comments/comment.contract';
import {
  parseStatusCreate,
  parseStatusReaction,
} from '../../src/status/status.contract';
import {
  parseNotificationListQuery,
  parseNotificationSettings,
  parsePushToken,
} from '../../src/notifications/notification.contract';
import {
  parseModerationDecision,
  parseReportCreate,
} from '../../src/reports/report.contract';

describe('post contracts', () => {
  it('bounds list and search queries', () => {
    expect(parsePostListQuery({ page: '0', limit: '500' })).toEqual({
      page: 1,
      limit: 50,
    });
    expect(parsePostListQuery({})).toEqual({ page: 1, limit: 20 });
    expect(parsePostSearchQuery({ q: '  aeko  ' })).toEqual({
      q: 'aeko',
      page: 1,
      limit: 20,
    });
    expect(() => parsePostSearchQuery({})).toThrow('q');
  });

  it('accepts a complete post and supplies stable defaults', () => {
    expect(parsePostCreate({ type: 'text', text: ' Hello ' })).toEqual({
      text: 'Hello',
      type: 'text',
      privacy: { level: 'public', selectedUsers: [] },
    });
    expect(
      parsePostCreate({
        type: 'image',
        privacy: 'select_users',
        selectedUsers: '["u1","u2"]',
      }).privacy,
    ).toEqual({ level: 'select_users', selectedUsers: ['u1', 'u2'] });
  });

  it('rejects invalid types, privacy levels, and empty selections', () => {
    expect(() => parsePostCreate({ type: 'audio' })).toThrow('type');
    expect(() => parsePostCreate({ type: 'text', privacy: 'secret' })).toThrow(
      'privacy',
    );
    expect(() =>
      parsePostCreate({
        type: 'text',
        privacy: 'select_users',
        selectedUsers: '[]',
      }),
    ).toThrow('selectedUsers');
    expect(() =>
      parsePostCreate({
        type: 'text',
        privacy: 'select_users',
        selectedUsers: 'not-json',
      }),
    ).toThrow('selectedUsers');
  });

  it('allows only the reviewed mutable field on update', () => {
    expect(parsePostUpdate({ text: ' Revised ' })).toEqual({ text: 'Revised' });
    for (const field of ['userId', 'likes', 'views', 'privacy', 'createdAt']) {
      expect(() => parsePostUpdate({ [field]: 'injected' })).toThrow(field);
    }
    expect(() => parsePostUpdate({})).toThrow('update');
  });

  it('requires a selection when switching to select_users', () => {
    expect(parsePostPrivacy({ privacy: 'followers' })).toEqual({
      level: 'followers',
      selectedUsers: [],
    });
    expect(() => parsePostPrivacy({ privacy: 'select_users' })).toThrow(
      'selectedUsers',
    );
    expect(() => parsePostPrivacy({})).toThrow('privacy');
  });
});

describe('post visibility policy', () => {
  const viewer = {
    viewerId: 'viewer',
    isOwner: false,
    isFollower: false,
    isBlocked: false,
  };

  it('reads stored privacy tolerantly', () => {
    expect(readPostVisibility(null)).toEqual({
      level: 'public',
      selectedUsers: [],
    });
    expect(readPostVisibility('corrupted')).toEqual({
      level: 'public',
      selectedUsers: [],
    });
    expect(
      readPostVisibility({ level: 'select_users', selectedUsers: ['a', 1] }),
    ).toEqual({ level: 'select_users', selectedUsers: ['a'] });
  });

  it('applies each privacy level', () => {
    expect(canViewPost({ level: 'public', selectedUsers: [] }, viewer)).toBe(
      true,
    );
    expect(canViewPost({ level: 'followers', selectedUsers: [] }, viewer)).toBe(
      false,
    );
    expect(
      canViewPost(
        { level: 'followers', selectedUsers: [] },
        {
          ...viewer,
          isFollower: true,
        },
      ),
    ).toBe(true);
    expect(canViewPost({ level: 'only_me', selectedUsers: [] }, viewer)).toBe(
      false,
    );
    expect(
      canViewPost(
        { level: 'only_me', selectedUsers: [] },
        {
          ...viewer,
          isOwner: true,
        },
      ),
    ).toBe(true);
    expect(
      canViewPost({ level: 'select_users', selectedUsers: ['viewer'] }, viewer),
    ).toBe(true);
    expect(
      canViewPost({ level: 'select_users', selectedUsers: ['other'] }, viewer),
    ).toBe(false);
  });

  it('never shows a blocked author, even for a public post the owner sees', () => {
    expect(
      canViewPost(
        { level: 'public', selectedUsers: [] },
        {
          ...viewer,
          isBlocked: true,
        },
      ),
    ).toBe(false);
    expect(
      canViewPost(
        { level: 'public', selectedUsers: [] },
        {
          ...viewer,
          isOwner: true,
          isBlocked: true,
        },
      ),
    ).toBe(false);
  });

  it('treats an anonymous viewer as public-only', () => {
    const anonymous = { ...viewer, viewerId: null };
    expect(canViewPost({ level: 'public', selectedUsers: [] }, anonymous)).toBe(
      true,
    );
    expect(
      canViewPost({ level: 'select_users', selectedUsers: [''] }, anonymous),
    ).toBe(false);
  });
});

describe('comment contracts', () => {
  it('bounds comment text and pages', () => {
    expect(parseCommentCreate({ text: ' Nice ' })).toEqual({ text: 'Nice' });
    expect(() => parseCommentCreate({ text: '   ' })).toThrow('text');
    expect(() => parseCommentCreate({ text: 'x', userId: 'victim' })).toThrow(
      'userId',
    );
    expect(parseCommentListQuery({ limit: '900' })).toEqual({
      page: 1,
      limit: 50,
    });
  });
});

describe('status contracts', () => {
  it('accepts the legacy status shape and reaction allowlist', () => {
    expect(
      parseStatusCreate({ type: 'text', content: ' Hi ', caption: null }),
    ).toEqual({
      type: 'text',
      content: 'Hi',
      caption: null,
      backgroundColor: null,
      font: null,
    });
    expect(() => parseStatusCreate({ type: 'text' })).toThrow('content');
    // Legacy accepts any emoji string; it is bounded rather than allowlisted so
    // existing clients keep working.
    expect(parseStatusReaction({ emoji: ' 👍 ' })).toEqual({ emoji: '👍' });
    expect(() => parseStatusReaction({ emoji: '' })).toThrow('emoji');
    expect(() => parseStatusReaction({ emoji: 'x'.repeat(50) })).toThrow(
      'emoji',
    );
    expect(() =>
      parseStatusReaction({ emoji: '👍', userId: 'victim' }),
    ).toThrow('userId');
  });
});

describe('notification contracts', () => {
  it('bounds the inbox and validates settings and tokens', () => {
    // Legacy accepted `?type=` to filter the inbox by notification kind.
    expect(parseNotificationListQuery({ limit: '900' })).toEqual({
      page: 1,
      limit: 50,
      unreadOnly: false,
      type: null,
    });
    expect(parseNotificationListQuery({ type: 'LIKE' }).type).toBe('LIKE');
    // Legacy persisted the raw request body; the nested shape is now validated
    // and merged onto the documented defaults.
    const settings = parseNotificationSettings({
      interactions: { likes: false },
    });
    expect(settings.interactions.likes).toBe(false);
    expect(settings.interactions.comments).toBe(true);
    expect(settings.network.newFollowers).toBe(true);
    expect(settings.global.pauseAll).toBe(false);
    expect(() => parseNotificationSettings({ recipientId: 'victim' })).toThrow(
      'recipientId',
    );
    expect(() =>
      parseNotificationSettings({ interactions: { likes: 'yes' } }),
    ).toThrow('likes');

    expect(parsePushToken({ pushToken: ' abc123 ' })).toEqual({
      pushToken: 'abc123',
    });
    expect(() => parsePushToken({ pushToken: '' })).toThrow('pushToken');
  });
});

describe('report contracts', () => {
  it('requires an entity and a bounded reason', () => {
    expect(
      parseReportCreate({
        entityType: 'POST',
        entityId: 'p1',
        reason: ' Spam ',
      }),
    ).toEqual({
      entityType: 'POST',
      entityId: 'p1',
      reportedId: null,
      reason: 'Spam',
    });
    expect(() =>
      parseReportCreate({ entityType: 'GALAXY', entityId: 'p1', reason: 'x' }),
    ).toThrow('entityType');
    expect(() =>
      parseReportCreate({ entityType: 'POST', entityId: 'p1' }),
    ).toThrow('reason');
  });

  it('requires a moderation reason and rejects unknown fields', () => {
    expect(parseModerationDecision({ reason: ' Abuse ' })).toEqual({
      reason: 'Abuse',
      durationDays: null,
    });
    expect(() => parseModerationDecision({})).toThrow('reason');
    expect(() =>
      parseModerationDecision({ reason: 'x', adminId: 'victim' }),
    ).toThrow('adminId');
  });
});
