import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker as BullWorker, type ConnectionOptions } from 'bullmq';
import {
  ChatOutboxStore,
  createChatOutboxPrismaClient,
} from '../../chat-delivery/chat-outbox-prisma.client';
import { ConfigurationService } from '../../configuration/configuration/configuration.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { ChatEventTransport } from '../chat-event-publisher';
import {
  CHAT_DELIVERY_QUEUE,
  type ChatDeliveryJob,
} from './chat-delivery.contract';
import {
  ChatDeliveryWorker,
  DeliveryEffects,
  DeliveryState,
} from './chat-delivery.worker';
import { ChatDeliveryQueue } from './chat-outbox-dispatcher.service';
import { ChatOutboxDispatcherService } from './chat-outbox-dispatcher.service';

@Injectable()
export class PrismaChatOutboxStore extends ChatOutboxStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  claimBatch(limit: number) {
    return createChatOutboxPrismaClient(this.prisma.db).claimBatch(limit);
  }

  release(id: string): Promise<void> {
    return createChatOutboxPrismaClient(this.prisma.db).release(id);
  }
}

@Injectable()
export class BullMqChatDeliveryQueue
  extends ChatDeliveryQueue
  implements OnModuleInit, OnModuleDestroy
{
  private queue: Queue<ChatDeliveryJob> | undefined;

  constructor(private readonly configuration: ConfigurationService) {
    super();
  }

  onModuleInit(): void {
    const url = this.configuration.value.redisUrl;
    if (url)
      this.queue = new Queue(CHAT_DELIVERY_QUEUE, { connection: { url } });
  }

  async add(
    job: ChatDeliveryJob,
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: 'exponential'; delay: number };
    },
  ): Promise<void> {
    if (!this.queue) throw new Error('Chat delivery queue is unavailable');
    await this.queue.add(job.eventType, job, options);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.queue = undefined;
  }
}

@Injectable()
export class PrismaChatDeliveryState extends DeliveryState {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isCompleted(id: string): Promise<boolean> {
    const row = await this.prisma.db.chatOutboxEvent.findUnique({
      where: { id },
      select: { completedAt: true },
    });
    return row?.completedAt !== null && row?.completedAt !== undefined;
  }

  async complete(id: string): Promise<void> {
    await this.prisma.db.chatOutboxEvent.update({
      where: { id },
      data: {
        completedAt: new Date(),
        claimedAt: null,
        failedAt: null,
        lastErrorCode: null,
      },
    });
  }

  async fail(id: string, code: string): Promise<void> {
    await this.prisma.db.chatOutboxEvent.update({
      where: { id },
      data: {
        claimedAt: null,
        failedAt: new Date(),
        lastErrorCode: code,
        availableAt: new Date(Date.now() + 1_000),
      },
    });
  }
}

@Injectable()
export class SocketChatDeliveryEffects extends DeliveryEffects {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: ChatEventTransport,
  ) {
    super();
  }

  async execute(job: ChatDeliveryJob): Promise<void> {
    if (job.eventType !== 'message.created') {
      throw new Error(`Unsupported chat delivery event: ${job.eventType}`);
    }
    const message = await this.prisma.db.enhancedMessage.findUnique({
      where: { id: job.aggregateId },
      select: {
        id: true,
        chatId: true,
        clientMessageId: true,
        sequence: true,
        createdAt: true,
      },
    });
    if (!message || message.sequence === null)
      throw new Error('Chat delivery message is unavailable');
    await this.transport.toRoom(
      `chat:${message.chatId}`,
      'new_message',
      message,
    );
  }
}

@Injectable()
export class ChatDeliveryRuntime
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private worker: BullWorker<ChatDeliveryJob> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly dispatcher: ChatOutboxDispatcherService,
    private readonly delivery: ChatDeliveryWorker,
  ) {}

  onApplicationBootstrap(): void {
    const url = this.configuration.value.redisUrl;
    if (!url) return;
    const connection: ConnectionOptions = { url };
    this.worker = new BullWorker(
      CHAT_DELIVERY_QUEUE,
      async (job) => this.delivery.process(job.data),
      { connection, concurrency: 20 },
    );
    this.timer = setInterval(() => void this.dispatcher.dispatchBatch(), 1_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.worker?.close();
    this.worker = undefined;
  }
}
