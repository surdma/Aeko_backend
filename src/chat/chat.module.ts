import { Module } from '@nestjs/common';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({ controllers: [ChatController], providers: [ChatAuthorizationService, ChatService], exports: [ChatService] })
export class ChatModule {}
