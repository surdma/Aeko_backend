/* eslint-disable @typescript-eslint/require-await -- async test doubles implement queue ports */
import { ChatOutboxDispatcherService } from '../../src/chat/delivery/chat-outbox-dispatcher.service';
describe('queue degradation', () => {
  it('leaves durable records recoverable when enqueue fails', async () => {
    const dispatcher = new ChatOutboxDispatcherService(
      {
        claimBatch: async () => [
          { id: 'e', aggregateId: 'a', eventType: 'chat.message.created' },
        ],
      } as never,
      {
        add: async () => {
          throw new Error('redis down');
        },
      },
    );
    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      queued: 0,
    });
  });
});
