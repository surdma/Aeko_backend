import { Module } from '@nestjs/common';
import { ChatAuthorizationService } from './chat-authorization.service';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatEventPublisher } from './chat-event-publisher';
import { ChatRecoveryService } from './chat-recovery.service';
import { ChatMediaController } from './media/chat-media.controller';
import { ChatAttachmentService } from './media/chat-attachment.service';
import { VideoCallAuthorizationService } from './signalling/video-call-authorization.service';
import { VideoCallsGateway } from './signalling/video-calls.gateway';

@Module({ controllers: [ChatController, ChatMediaController], providers: [ChatAuthorizationService, ChatService, ChatGateway, ChatEventPublisher, ChatRecoveryService, ChatAttachmentService, VideoCallAuthorizationService, VideoCallsGateway], exports: [ChatService, ChatRecoveryService] })
export class ChatModule {}
