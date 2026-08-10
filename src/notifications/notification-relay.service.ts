import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { ConfigurationService } from '../configuration/configuration/configuration.service';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  createNotificationPrismaClient,
  type NotificationRecord,
} from './notification-prisma.client';
import { NotificationBusPort } from './notification-bus.port';
import { toNotificationEvent } from './notifications.service';

export const RELAY_QUEUE = 'aeko:notification-relay';
export const RELAY_JOB = 'scan';

/** How often the relay looks for rows this service did not publish itself. */
export const RELAY_INTERVAL_MILLISECONDS = 2_000;

/** Upper bound on rows examined per scan, so a backlog cannot stall the loop. */
export const RELAY_BATCH = 200;

/** Ids held to suppress a republish when two scans overlap the same second. */
const SEEN_LIMIT = 2_000;

/**
 * Publishes notifications written by *any* producer to the realtime bus.
 *
 * Redis pub/sub alone only carries what this service publishes. The legacy
 * Express service writes notifications directly to Postgres and never calls
 * `PUBLISH`, so without this relay the stream would silently miss them. BullMQ
 * owns the schedule because the scan must run once per cluster: a bare
 * `setInterval` in every replica would republish each row once per replica.
 *
 * When the Express writer is retired this class can be deleted outright and
 * delivery becomes pure push, with no other change.
 */
@Injectable()
export class NotificationRelayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationRelayService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private watermark = new Date();
  private seen: string[] = [];

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly prisma: PrismaService,
    private readonly bus: NotificationBusPort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const url = this.configuration.redisUrl;
    if (url === null) {
      // No broker: the REST inbox is unaffected and no relay is started.
      return;
    }
    const connection: ConnectionOptions = { url };
    this.queue = new Queue(RELAY_QUEUE, { connection });
    this.worker = new Worker(RELAY_QUEUE, async () => this.scan(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (_job, error: Error) => {
      // A failed scan must never take the process down; the next tick retries.
      this.logger.warn(`Notification relay scan failed: ${error.message}`);
    });
    await this.queue.upsertJobScheduler(RELAY_JOB, {
      every: RELAY_INTERVAL_MILLISECONDS,
    });
  }

  /**
   * One pass: publish every notification created after the watermark that has
   * not already been published, then advance the watermark.
   */
  async scan(): Promise<number> {
    const notifications = createNotificationPrismaClient(this.prisma.db);
    const records = await notifications.findCreatedAfter(
      this.watermark,
      RELAY_BATCH,
    );
    const fresh = records.filter((record) => !this.seen.includes(record.id));
    for (const record of fresh) {
      await this.bus.publish(toNotificationEvent(record));
    }
    this.remember(fresh);
    this.advance(records);
    return fresh.length;
  }

  private remember(records: readonly NotificationRecord[]): void {
    this.seen = [...this.seen, ...records.map((record) => record.id)].slice(
      -SEEN_LIMIT,
    );
  }

  /**
   * The watermark moves to the newest row seen. Rows sharing that timestamp are
   * re-read on the next scan and suppressed by the seen set, which is why the
   * scan is `gt` rather than `gte` on an advanced watermark.
   */
  private advance(records: readonly NotificationRecord[]): void {
    for (const record of records) {
      if (record.createdAt > this.watermark) this.watermark = record.createdAt;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.queue = null;
  }
}
