import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { MediaModule } from '../providers/media/media.module';
import { ChatAiPort } from '../providers/ai/chat-ai.port';
import { UnavailableChatAiAdapter } from '../providers/ai/unavailable-chat-ai.adapter';
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
import { ChatStore } from './chat-prisma.client';
import { ChatMembershipPort } from './chat-authorization.service';
import { ChatRecoveryStore } from './chat-recovery.service';
import {
  PrismaChatMembershipPort,
  PrismaChatRecoveryStore,
  PrismaChatStore,
} from './chat-runtime.adapters';
import { BotStore } from './bot/bot-prisma.client';
import { UnavailableBotStore } from './bot/unavailable-bot-store';

@Module({
  imports: [RealtimeModule, ChatDeliveryModule, MediaModule],
  controllers: [ChatController, ChatMediaController, BotController],
  providers: [
    ChatAuthorizationService,
    PrismaChatMembershipPort,
    { provide: ChatMembershipPort, useExisting: PrismaChatMembershipPort },
    PrismaChatStore,
    { provide: ChatStore, useExisting: PrismaChatStore },
    PrismaChatRecoveryStore,
    { provide: ChatRecoveryStore, useExisting: PrismaChatRecoveryStore },
    { provide: ChatAiPort, useClass: UnavailableChatAiAdapter },
    { provide: BotStore, useClass: UnavailableBotStore },
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
