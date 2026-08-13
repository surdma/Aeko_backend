import type { OnGatewayInit } from '@nestjs/websockets';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import {
  parseSendMessage,
  type ChatAck,
  type WsPublicError,
} from './chat.contract';
import { ChatAuthorizationService } from './chat-authorization.service';
import {
  ChatEventPublisher,
  SocketIoChatEventTransport,
} from './chat-event-publisher';
import { ChatService } from './chat.service';

export interface AuthenticatedSocket {
  readonly id: string;
  readonly data: { readonly principal: AuthenticatedPrincipal };
  join(room: string): Promise<void> | void;
}
type Ack = (value: ChatAck | WsPublicError) => void;

@WebSocketGateway({ namespace: '/', cors: false })
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly authorization: ChatAuthorizationService,
    private readonly publisher: ChatEventPublisher,
    private readonly transport: SocketIoChatEventTransport,
  ) {}

  afterInit(): void {
    this.transport.bind(this.server);
  }

  private async safely(
    ack: Ack,
    action: () => Promise<ChatAck>,
  ): Promise<void> {
    try {
      ack(await action());
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        ack({
          code:
            error.code === 'AUTHORIZATION_DENIED'
              ? 'FORBIDDEN'
              : 'INVALID_PAYLOAD',
          message: error.message,
        });
      } else ack({ code: 'UNAVAILABLE', message: 'Message could not be sent' });
    }
  }

  @SubscribeMessage('join_chat')
  async join(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { chatId: string },
    ack: Ack,
  ): Promise<void> {
    await this.safely(ack, async () => {
      await this.authorization.assertMember(
        socket.data.principal.userId,
        body.chatId,
      );
      await socket.join(`chat:${body.chatId}`);
      return {
        success: true,
        messageId: body.chatId,
        timestamp: new Date().toISOString(),
      };
    });
  }

  @SubscribeMessage('send_message')
  async send(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: unknown,
    ack: Ack,
  ): Promise<void> {
    await this.safely(ack, async () => {
      const message = await this.chat.sendMessage(
        socket.data.principal,
        parseSendMessage(body),
      );
      await this.publisher.messageCreated(message);
      return {
        success: true,
        messageId: message.id,
        ...(message.clientMessageId === null
          ? {}
          : { clientMessageId: message.clientMessageId }),
        timestamp: message.createdAt.toISOString(),
      };
    });
  }
}
