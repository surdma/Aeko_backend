import { Injectable } from '@nestjs/common';
import type { PersistedChatMessage } from './chat-prisma.client';

export abstract class ChatEventTransport {
  abstract toRoom(room: string, event: string, payload: unknown): Promise<void>;
}

@Injectable()
export class ChatEventPublisher {
  constructor(private readonly transport: ChatEventTransport) {}
  messageCreated(message: PersistedChatMessage): Promise<void> {
    return this.transport.toRoom(`chat:${message.chatId}`, 'new_message', message);
  }
}
