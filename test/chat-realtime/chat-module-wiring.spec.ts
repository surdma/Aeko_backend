import { MODULE_METADATA } from '@nestjs/common/constants';
import { ChatEventTransport } from '../../src/chat/chat-event-publisher';
import { ChatModule } from '../../src/chat/chat.module';
import { RealtimeModule } from '../../src/realtime/realtime.module';

describe('ChatModule realtime wiring', () => {
  it('binds a concrete Socket.IO transport for chat events', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ChatModule,
    ) as readonly unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      RealtimeModule,
    ) as readonly unknown[];
    expect(imports).toContain(RealtimeModule);
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: ChatEventTransport }),
      ]),
    );
  });
});
