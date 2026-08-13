/* eslint-disable @typescript-eslint/require-await -- async test doubles implement gateway ports */
import { ChatGateway } from '../../src/chat/chat.gateway';
import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';

const principal: AuthenticatedPrincipal = {
  userId: '22222222-2222-4222-8222-222222222222',
  email: 'a@b.test',
  username: 'a',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: false,
  twoFactorSatisfied: false,
  sessionId: 's',
};
const chatId = '11111111-1111-4111-8111-111111111111';

describe('ChatGateway', () => {
  it('authorizes before joining a server-owned room', async () => {
    const calls: string[] = [];
    const gateway = new ChatGateway(
      {} as never,
      {
        assertMember: async () => {
          calls.push('authorize');
        },
      } as never,
      {} as never,
    );
    const ack = jest.fn();
    await gateway.join(
      {
        id: 'c',
        data: { principal },
        join: async (room) => {
          calls.push(room);
        },
      },
      { chatId },
      ack,
    );
    expect(calls).toEqual(['authorize', `chat:${chatId}`]);
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('persists before publishing and acknowledges a durable send', async () => {
    const calls: string[] = [];
    const message = {
      id: '55555555-5555-4555-8555-555555555555',
      chatId,
      clientMessageId: null,
      sequence: 1n,
      createdAt: new Date('2025-01-01T00:00:00Z'),
    };
    const gateway = new ChatGateway(
      {
        sendMessage: async () => {
          calls.push('persist');
          return message;
        },
      } as never,
      {} as never,
      {
        messageCreated: async () => {
          calls.push('publish');
        },
      } as never,
    );
    const ack = jest.fn();
    await gateway.send(
      { id: 'c', data: { principal }, join: async () => undefined },
      { chatId, content: 'hi' },
      ack,
    );
    expect(calls).toEqual(['persist', 'publish']);
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, messageId: message.id }),
    );
  });
});
