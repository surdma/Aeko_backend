import { Injectable } from '@nestjs/common';
import type { ChatDeliveryJob } from './chat-delivery.contract';
export abstract class DeliveryEffects {
  abstract execute(job: ChatDeliveryJob): Promise<void>;
}
export abstract class DeliveryState {
  abstract isCompleted(id: string): Promise<boolean>;
  abstract complete(id: string): Promise<void>;
  abstract fail(id: string, code: string): Promise<void>;
}
@Injectable()
export class ChatDeliveryWorker {
  constructor(
    private readonly effects: DeliveryEffects,
    private readonly state: DeliveryState,
  ) {}
  async process(job: ChatDeliveryJob) {
    if (await this.state.isCompleted(job.outboxEventId)) return;
    try {
      await this.effects.execute(job);
      await this.state.complete(job.outboxEventId);
    } catch {
      await this.state.fail(job.outboxEventId, 'DELIVERY_FAILED');
      throw new Error('Chat delivery failed');
    }
  }
}
