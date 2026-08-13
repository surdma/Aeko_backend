import { MODULE_METADATA } from '@nestjs/common/constants';
import { ChatEventTransport } from '../../src/chat/chat-event-publisher';
import { ChatModule } from '../../src/chat/chat.module';

describe('ChatModule realtime wiring', () => {
  it('binds a concrete Socket.IO transport for chat events', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      ChatModule,
    ) as readonly unknown[];
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: ChatEventTransport }),
      ]),
    );
  });
});
