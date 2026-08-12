import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../configuration/configuration/configuration.service';
import { RedisConnectionsService } from './redis-connections.service';

export type RealtimeRateLimitDecision = 'allow' | 'deny' | 'drop-ephemeral';

export interface RealtimeRateLimitInput {
  readonly principalId: string;
  readonly event: string;
}

interface LocalBucket {
  count: number;
  resetAt: number;
}

const EPHEMERAL_EVENTS = new Set(['typing_start', 'typing_stop']);
const WINDOW_MS = 60_000;
const LOCAL_LIMIT = 10;
const DISTRIBUTED_LIMIT = 60;

const TOKEN_BUCKET_LUA = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if value <= tonumber(ARGV[2]) then return 1 end
return 0
`;

@Injectable()
export class RealtimeRateLimiterService {
  private readonly localBuckets = new Map<string, LocalBucket>();

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly connections?: RedisConnectionsService,
  ) {}

  async consume(input: RealtimeRateLimitInput): Promise<RealtimeRateLimitDecision> {
    // Read configuration here to make disabled Redis an intentional, explicit
    // local-safe-mode rather than an accidental missing dependency.
    if (this.configuration.redisUrl === null) {
      return this.decision(input.event, this.consumeLocal(input));
    }
    const cache = this.connections?.cache() ?? null;
    const allowed = cache
      ? await this.consumeDistributed(cache, input).catch(() => null)
      : null;
    if (allowed !== null) return this.decision(input.event, allowed);
    return this.decision(input.event, this.consumeLocal(input));
  }

  private async consumeDistributed(
    cache: NonNullable<ReturnType<RedisConnectionsService['cache']>>,
    input: RealtimeRateLimitInput,
  ): Promise<boolean> {
    const key = `aeko:realtime:rate:${input.principalId}:${input.event}`;
    const result = await cache.eval(
      TOKEN_BUCKET_LUA,
      1,
      key,
      String(WINDOW_MS),
      String(DISTRIBUTED_LIMIT),
    );
    return result === 1;
  }

  private consumeLocal(input: RealtimeRateLimitInput): boolean {
    const key = `${input.principalId}:${input.event}`;
    const now = Date.now();
    const bucket = this.localBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.localBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= LOCAL_LIMIT;
  }

  private decision(event: string, allowed: boolean): RealtimeRateLimitDecision {
    if (allowed) return 'allow';
    return EPHEMERAL_EVENTS.has(event) ? 'drop-ephemeral' : 'deny';
  }
}
