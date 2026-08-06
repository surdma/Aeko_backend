import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { LoggingModule } from './common/logging.module.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { AppConfigurationModule } from './config/configuration.js';
import { HealthModule } from './health/health.module.js';
import { InterestsModule } from './interests/interests.module.js';
import { WaitlistModule } from './waitlist/waitlist.module.js';

@Module({
  imports: [
    AppConfigurationModule.forRoot(),
    LoggingModule,
    HealthModule,
    WaitlistModule,
    InterestsModule,
  ],
  providers: [HttpExceptionFilter],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
