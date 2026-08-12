import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigurationService } from '../configuration/configuration/configuration.service';
import { RealtimeHealthService } from './realtime-health.service';

export type RedisConnectionKind = 'publisher' | 'subscriber' | 'cache' | 'queue';

@Injectable()
export class RedisConnectionsService implements OnModuleDestroy {
  private readonly clients = new Map<RedisConnectionKind, Redis>();
  private available: boolean | null = null;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly health: RealtimeHealthService,
  ) {}

  get enabled(): boolean {
    return this.configuration.redisUrl !== null;
  }

  get ready(): boolean {
    return this.available === true;
  }

  async connect(): Promise<boolean> {
    if (!this.enabled) {
      this.available = false;
      this.health.markDisabled();
      return false;
    }
    try {
      await Promise.all([
        this.client('publisher').connect(),
        this.client('subscriber').connect(),
        this.client('cache').connect(),
        this.client('queue').connect(),
      ]);
      this.available = true;
      this.health.markRedisReady();
      return true;
    } catch {
      this.available = false;
      this.health.markDegraded('REDIS_UNAVAILABLE');
      await this.closeClients();
      return false;
    }
  }

  publisher(): Redis | null {
    return this.ready ? this.client('publisher') : null;
  }

  subscriber(): Redis | null {
    return this.ready ? this.client('subscriber') : null;
  }

  cache(): Redis | null {
    return this.ready ? this.client('cache') : null;
  }

  queue(): Redis | null {
    return this.ready ? this.client('queue') : null;
  }

  async onModuleDestroy(): Promise<void> {
    this.available = false;
    await this.closeClients();
  }

  private client(kind: RedisConnectionKind): Redis {
    const existing = this.clients.get(kind);
    if (existing) return existing;
    const url = this.configuration.redisUrl;
    if (!url) {
      throw new Error('Redis is not configured.');
    }
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: kind === 'queue' ? null : 1,
      enableReadyCheck: true,
    });
    client.on('error', () => {
      this.available = false;
      this.health.markDegraded('REDIS_UNAVAILABLE');
    });
    this.clients.set(kind, client);
    return client;
  }

  private async closeClients(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((client) =>
        client.quit().catch(() => client.disconnect()),
      ),
    );
    this.clients.clear();
  }
}
