import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatMembershipCacheService } from './chat-membership-cache.service';
import { PresencePort, RedisPresenceService } from './presence.service';
import { RedisConnectionsService } from './redis-connections.service';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeHealthService } from './realtime-health.service';
import { RealtimeRateLimiterService } from './realtime-rate-limiter.service';
import { RealtimeRoomNames } from './realtime-room-names';
import { SocketIoRedisAdapter } from './socket-io-redis.adapter';

@Module({
  imports: [AuthModule],
  providers: [
    RealtimeHealthService,
    RedisConnectionsService,
    SocketIoRedisAdapter,
    RealtimeAuthService,
    RealtimeRoomNames,
    RealtimeRateLimiterService,
    ChatMembershipCacheService,
    { provide: PresencePort, useClass: RedisPresenceService },
  ],
  exports: [
    SocketIoRedisAdapter,
    RealtimeAuthService,
    RealtimeRoomNames,
    RealtimeRateLimiterService,
    RealtimeHealthService,
    ChatMembershipCacheService,
    PresencePort,
  ],
})
export class RealtimeModule {}
