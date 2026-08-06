import { Module } from '@nestjs/common';
import { SanitizedLogger } from './sanitized-logger.js';

@Module({
  providers: [SanitizedLogger],
  exports: [SanitizedLogger],
})
export class LoggingModule {}
