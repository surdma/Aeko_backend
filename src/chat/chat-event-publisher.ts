import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { PersistedChatMessage } from './chat-prisma.client';

export abstract class ChatEventTransport {
  abstract toRoom(room: string, event: string, payload: unknown): Promise<void>;
}

@Injectable()
export class SocketIoChatEventTransport extends ChatEventTransport {
  private server: Server | undefined;

  bind(server: Server): void {
    this.server = server;
  }

  toRoom(room: string, event: string, payload: unknown): Promise<void> {
    if (!this.server) throw new Error('Socket.IO chat transport is not ready');
    this.server.to(room).emit(event, payload);
    return Promise.resolve();
  }
}

@Injectable()
export class ChatEventPublisher {
  constructor(private readonly transport: ChatEventTransport) {}
  messageCreated(message: PersistedChatMessage): Promise<void> {
    return this.transport.toRoom(
      `chat:${message.chatId}`,
      'new_message',
      message,
    );
  }
}
