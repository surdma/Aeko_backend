/* eslint-disable @typescript-eslint/require-await -- async test doubles implement delivery ports */
import { ChatDeliveryWorker } from '../../src/chat/delivery/chat-delivery.worker';
describe('delivery', () => {
  it('skips an already completed idempotency key', async () => {
    const execute = jest.fn();
    const worker = new ChatDeliveryWorker(
      { execute },
      {
        isCompleted: async () => true,
        complete: async () => undefined,
        fail: async () => undefined,
      },
    );
    await worker.process({
      outboxEventId: 'e',
      aggregateId: 'a',
      eventType: 'message.created',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
