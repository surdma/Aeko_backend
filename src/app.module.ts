import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from './configuration/configuration/configuration.service';
import { ConfigurationModule } from './configuration/configuration.module';
import { DatabaseModule } from './database/database.module';
import type { PrismaLifecycleClient } from './database/prisma/prisma.service';
import { HealthModule } from './health/health.module';
import {
  RequestContext,
  RequestContextMiddleware,
} from './common/http/request-context/request-context.middleware';

@Module({})
export class AppModule {
  static register(
    configuration: AppConfig,
    databaseClient?: PrismaLifecycleClient,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigurationModule.register(configuration),
        DatabaseModule.register(configuration, databaseClient),
        HealthModule,
      ],
      providers: [RequestContext, RequestContextMiddleware],
      exports: [RequestContext],
    };
  }
}
