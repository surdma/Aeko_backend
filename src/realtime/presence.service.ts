import { Injectable } from '@nestjs/common';
import { RedisConnectionsService } from './redis-connections.service';

export abstract class PresencePort {
  abstract heartbeat(userId: string, connectionId: string): Promise<void>;
  abstract disconnect(userId: string, connectionId: string): Promise<void>;
  abstract isOnline(userId: string): Promise<boolean>;
}

const PRESENCE_TTL_MS = 45_000;

@Injectable()
export class RedisPresenceService extends PresencePort {
  constructor(private readonly connections: RedisConnectionsService) {
    super();
  }

  async heartbeat(userId: string, connectionId: string): Promise<void> {
    const cache = this.connections.cache();
    if (!cache) return;
    const key = this.connectionKey(userId, connectionId);
    await cache.set(key, '1', 'PX', PRESENCE_TTL_MS).catch(() => undefined);
  }

  async disconnect(userId: string, connectionId: string): Promise<void> {
    const cache = this.connections.cache();
    if (!cache) return;
    await cache
      .del(this.connectionKey(userId, connectionId))
      .catch(() => undefined);
  }

  async isOnline(userId: string): Promise<boolean> {
    const cache = this.connections.cache();
    if (!cache) return false;
    const [, keys] = await cache
      .scan(0, 'MATCH', `aeko:realtime:presence:${userId}:*`, 'COUNT', 10)
      .catch(() => ['0', []] as [string, string[]]);
    return keys.length > 0;
  }

  private connectionKey(userId: string, connectionId: string): string {
    return `aeko:realtime:presence:${userId}:${connectionId}`;
  }
}
