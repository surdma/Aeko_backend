import { ChatAuthorizationService, ChatMembershipPort } from '../../src/chat/chat-authorization.service';
import { VideoCallAuthorizationService } from '../../src/chat/signalling/video-call-authorization.service';

describe('VideoCallAuthorizationService', () => {
  it('rejects a peer who is not a member of the named chat', async () => {
    const memberships: ChatMembershipPort = {
      isMember: async (_chatId, userId) => userId === 'member-a',
      invalidate: async () => undefined,
    };
    const calls = new VideoCallAuthorizationService(new ChatAuthorizationService(memberships));

    await expect(calls.assertPeers('member-a', 'attacker', 'chat-1')).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
  });
});
