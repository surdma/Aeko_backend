import { Module } from '@nestjs/common';
import { ChatOutboxDispatcherService } from './chat-outbox-dispatcher.service';
import { ChatDeliveryWorker } from './chat-delivery.worker';
import { ChatDeliveryHealthService } from './chat-delivery-health.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ChatOutboxStore } from '../../chat-delivery/chat-outbox-prisma.client';
import { ChatDeliveryQueue } from './chat-outbox-dispatcher.service';
import { DeliveryEffects, DeliveryState } from './chat-delivery.worker';
import {
  BullMqChatDeliveryQueue,
  ChatDeliveryRuntime,
  PrismaChatDeliveryState,
  PrismaChatOutboxStore,
  SocketChatDeliveryEffects,
} from './chat-delivery.adapters';
@Module({
  imports: [RealtimeModule],
  providers: [
    PrismaChatOutboxStore,
    { provide: ChatOutboxStore, useExisting: PrismaChatOutboxStore },
    BullMqChatDeliveryQueue,
    { provide: ChatDeliveryQueue, useExisting: BullMqChatDeliveryQueue },
    PrismaChatDeliveryState,
    { provide: DeliveryState, useExisting: PrismaChatDeliveryState },
    SocketChatDeliveryEffects,
    { provide: DeliveryEffects, useExisting: SocketChatDeliveryEffects },
    ChatOutboxDispatcherService,
    ChatDeliveryWorker,
    ChatDeliveryHealthService,
    ChatDeliveryRuntime,
  ],
  exports: [ChatOutboxDispatcherService, ChatDeliveryHealthService],
})
export class ChatDeliveryModule {}
