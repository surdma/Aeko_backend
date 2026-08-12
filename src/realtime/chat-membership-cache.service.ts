import { Inject, Injectable, Optional } from '@nestjs/common';
import { RedisConnectionsService } from './redis-connections.service';

export abstract class ChatMembershipReader {
  abstract isMember(chatId: string, userId: string): Promise<boolean>;
}

const MEMBERSHIP_TTL_SECONDS = 60;

@Injectable()
export class ChatMembershipCacheService {
  constructor(
    private readonly connections: RedisConnectionsService,
    @Optional()
    @Inject(ChatMembershipReader)
    private readonly reader?: ChatMembershipReader,
  ) {}

  async isMember(chatId: string, userId: string): Promise<boolean> {
    const cache = this.connections.cache();
    const key = this.key(chatId, userId);
    if (cache) {
      const cached = await cache.get(key).catch(() => null);
      if (cached === '1') return true;
      if (cached === '0') return false;
    }
    // Until the chat persistence boundary is registered, fail closed: a cache
    // miss must never grant a room membership from untrusted socket input.
    const member = this.reader
      ? await this.reader.isMember(chatId, userId)
      : false;
    if (cache) {
      await cache
        .set(key, member ? '1' : '0', 'EX', MEMBERSHIP_TTL_SECONDS)
        .catch(() => undefined);
    }
    return member;
  }

  async invalidate(chatId: string, userId: string): Promise<void> {
    const cache = this.connections.cache();
    if (cache) {
      await cache.del(this.key(chatId, userId)).catch(() => undefined);
    }
  }

  private key(chatId: string, userId: string): string {
    return `aeko:realtime:membership:${chatId}:${userId}`;
  }
}
