import { Module } from '@nestjs/common';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatEventPublisher } from './chat-event-publisher';
import { ChatRecoveryService } from './chat-recovery.service';

@Module({ controllers: [ChatController], providers: [ChatAuthorizationService, ChatService, ChatGateway, ChatEventPublisher, ChatRecoveryService], exports: [ChatService, ChatRecoveryService] })
export class ChatModule {}
