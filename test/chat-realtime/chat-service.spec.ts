import { ChatService } from '../../src/chat/chat.service';
import type { ChatStore } from '../../src/chat/chat-prisma.client';
import { ChatAuthorizationService } from '../../src/chat/chat-authorization.service';
import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const OUTSIDER_ID = '33333333-3333-4333-8333-333333333333';
const RECEIVER_ID = '44444444-4444-4444-8444-444444444444';
const member: AuthenticatedPrincipal = { userId: MEMBER_ID, email: 'member@example.test', username: 'member', isAdmin: false, banned: false, twoFactorEnabled: false, twoFactorSatisfied: false, sessionId: 'session' };

describe('ChatService', () => {
  it('rejects a non-member before appending a message', async () => {
    const calls: string[] = [];
    const authorization = new ChatAuthorizationService({ isMember: async (_chatId, userId) => { calls.push(`member:${userId}`); return false; }, invalidate: async () => undefined });
    const store: ChatStore = { appendMessage: async () => { throw new Error('must not append'); } };
    const service = new ChatService(store, authorization);
    await expect(service.sendMessage({ ...member, userId: OUTSIDER_ID }, { chatId: CHAT_ID, content: 'hello', clientMessageId: undefined, messageType: 'text', metadata: {} })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(calls).toEqual([`member:${OUTSIDER_ID}`]);
  });

  it('authorizes sender and receiver before appending the authenticated command', async () => {
    const calls: string[] = [];
    const authorization = new ChatAuthorizationService({ isMember: async (_chatId, userId) => { calls.push(`member:${userId}`); return true; }, invalidate: async () => undefined });
    const store: ChatStore = { appendMessage: async command => { calls.push('appendMessage'); expect(command.principalId).toBe(MEMBER_ID); return { id: '55555555-5555-4555-8555-555555555555', chatId: CHAT_ID, clientMessageId: null, sequence: 1n, createdAt: new Date() }; } };
    const service = new ChatService(store, authorization);
    await expect(service.sendMessage(member, { chatId: CHAT_ID, receiverId: RECEIVER_ID, content: 'hello', clientMessageId: undefined, messageType: 'text', metadata: {} })).resolves.toMatchObject({ sequence: 1n });
    expect(calls).toEqual([`member:${MEMBER_ID}`, `member:${RECEIVER_ID}`, 'appendMessage']);
  });
});
