import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { SanitizedLogger } from './common/sanitized-logger.js';
import { AppConfigurationModule } from './config/configuration.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [AppConfigurationModule.forRoot(), HealthModule],
  providers: [SanitizedLogger, HttpExceptionFilter],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
