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
 * How far back the relay looks when it starts.
 *
 * Starting at "now" would drop every notification written while the process
 * was restarting. Starting at the beginning of time would replay the entire
 * table on every boot. A short grace window covers the restart gap; anything
 * older has already been delivered or is stale enough that a live stream is
 * the wrong place to surface it.
 */
export const RELAY_STARTUP_GRACE_MILLISECONDS = 60_000;

export interface RelayHealth {
  readonly running: boolean;
  readonly scheduler: 'bullmq' | 'interval' | 'none';
  readonly transport: 'redis' | 'in-process';
  readonly watermark: string;
  readonly lastScanAt: string | null;
  readonly undeliveredSinceLastScan: number;
  readonly consecutiveFailedScans: number;
}

/**
 * Publishes notifications written by *any* producer to the realtime bus.
 *
 * The bus alone only carries what this service publishes. The legacy Express
 * service writes notifications directly to Postgres and never publishes, so
 * without this relay the stream would silently miss them.
 *
 * Scheduling depends on what is available. With Redis, BullMQ owns the
 * schedule because the scan must run once per cluster — a bare interval in
 * every replica would republish each row once per replica. Without Redis there
 * is by definition a single instance to serve the in-process bus, so a plain
 * interval is both sufficient and correct.
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
  private timer: NodeJS.Timeout | null = null;
  private watermark = new Date(Date.now() - RELAY_STARTUP_GRACE_MILLISECONDS);
  private seen: string[] = [];
  private lastScanAt: Date | null = null;
  private undelivered = 0;
  private failedScans = 0;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly prisma: PrismaService,
    private readonly bus: NotificationBusPort,
  ) {}

  /**
   * Sets the replay floor: only notifications created after this are
   * published. Defaults to the startup grace window.
   */
  watermarkFrom(from: Date): void {
    this.watermark = from;
  }

  async onApplicationBootstrap(): Promise<void> {
    const url = this.configuration.redisUrl;
    if (url === null) {
      this.timer = setInterval(() => {
        void this.safeScan();
      }, RELAY_INTERVAL_MILLISECONDS);
      // Never hold the process open on the relay alone.
      this.timer.unref();
      return;
    }
    const connection: ConnectionOptions = { url };
    this.queue = new Queue(RELAY_QUEUE, { connection });
    this.worker = new Worker(RELAY_QUEUE, async () => this.scan(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (_job, error: Error) => {
      this.recordFailure(error);
    });
    await this.queue.upsertJobScheduler(RELAY_JOB, {
      every: RELAY_INTERVAL_MILLISECONDS,
    });
  }

  /**
   * One pass: publish every notification created after the watermark that has
   * not already been published, then advance the watermark only as far as the
   * last row that was actually delivered.
   */
  async scan(): Promise<number> {
    const notifications = createNotificationPrismaClient(this.prisma.db);
    const records = await notifications.findCreatedAfter(
      this.watermark,
      RELAY_BATCH,
    );

    let delivered = 0;
    let blocked = false;
    this.undelivered = 0;

    // Records arrive oldest first. The watermark stops at the first failure so
    // that row — and everything after it — is retried on the next scan.
    for (const record of records) {
      if (this.seen.includes(record.id)) {
        if (!blocked) this.advance(record);
        continue;
      }
      const outcome = await this.bus.publish(toNotificationEvent(record));
      if (outcome === 'undelivered') {
        blocked = true;
        this.undelivered += 1;
        continue;
      }
      this.remember(record.id);
      delivered += 1;
      if (!blocked) this.advance(record);
    }

    this.lastScanAt = new Date();
    this.failedScans = 0;
    if (this.undelivered > 0) {
      this.logger.warn(
        `${this.undelivered} notification(s) could not be published; ` +
          'retrying on the next scan.',
      );
    }
    return delivered;
  }

  health(): RelayHealth {
    return Object.freeze({
      running: this.worker !== null || this.timer !== null,
      scheduler:
        this.worker !== null
          ? 'bullmq'
          : this.timer !== null
            ? 'interval'
            : 'none',
      transport: this.bus.transport,
      watermark: this.watermark.toISOString(),
      lastScanAt: this.lastScanAt?.toISOString() ?? null,
      undeliveredSinceLastScan: this.undelivered,
      consecutiveFailedScans: this.failedScans,
    });
  }

  private async safeScan(): Promise<void> {
    try {
      await this.scan();
    } catch (error: unknown) {
      this.recordFailure(error);
    }
  }

  /** A failed scan must never take the process down; the next tick retries. */
  private recordFailure(error: unknown): void {
    this.failedScans += 1;
    const reason = error instanceof Error ? error.message : 'unknown error';
    if (this.failedScans === 1 || this.failedScans % 30 === 0) {
      this.logger.warn(
        `Notification relay scan failed (${this.failedScans} in a row): ${reason}`,
      );
    }
  }

  private remember(id: string): void {
    this.seen = [...this.seen, id].slice(-SEEN_LIMIT);
  }

  private advance(record: NotificationRecord): void {
    if (record.createdAt > this.watermark) this.watermark = record.createdAt;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.queue = null;
  }
}
