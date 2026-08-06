import { Module } from '@nestjs/common';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { LegacyApiThrottlerExceptionFilter } from './legacy-api-throttler-exception.filter.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: minutes(15),
        limit: 100,
      },
    ]),
  ],
  providers: [LegacyApiThrottlerExceptionFilter],
  exports: [ThrottlerModule, LegacyApiThrottlerExceptionFilter],
})
export class ApiRateLimitModule {}
