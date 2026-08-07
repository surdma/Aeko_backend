import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AppAuthenticationModule } from './common/authentication/app-authentication.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { LoggingModule } from './common/logging.module.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { AppConfigurationModule } from './config/configuration.js';
import { HealthModule } from './modules/health/health.module.js';
import { InterestsModule } from './modules/interests/interests.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { WaitlistModule } from './modules/waitlist/waitlist.module.js';

@Module({
  imports: [
    AppConfigurationModule.forRoot(),
    LoggingModule,
    AppAuthenticationModule,
    HealthModule,
    WaitlistModule,
    InterestsModule,
    SupportModule,
    NotificationsModule,
  ],
  providers: [HttpExceptionFilter],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
