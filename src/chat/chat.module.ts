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
import { BotController } from './bot/bot.controller';
import { BotGateway } from './bot/bot.gateway';
import { BotService } from './bot/bot.service';
import { ChatDeliveryModule } from './delivery/chat-delivery.module';

@Module({
  imports: [ChatDeliveryModule],
  controllers: [ChatController, ChatMediaController, BotController],
  providers: [
    ChatAuthorizationService,
    ChatService,
    ChatGateway,
    ChatEventPublisher,
    ChatRecoveryService,
    ChatAttachmentService,
    VideoCallAuthorizationService,
    VideoCallsGateway,
    BotService,
    BotGateway,
  ],
  exports: [ChatService, ChatRecoveryService],
})
export class ChatModule {}
