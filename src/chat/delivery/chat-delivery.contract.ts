export const CHAT_DELIVERY_QUEUE = 'aeko:chat-delivery';
export interface ChatDeliveryJob {
  readonly outboxEventId: string;
  readonly aggregateId: string;
  readonly eventType:
    'message.created' | 'bot.requested' | 'media.scan.requested';
}
