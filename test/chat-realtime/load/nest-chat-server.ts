import 'dotenv/config';
import { DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuthModule } from '../../../src/auth/auth.module';
import { AuthRuntimeService } from '../../../src/auth/auth-runtime.service';
import { ChatModule } from '../../../src/chat/chat.module';
import { ConfigurationModule } from '../../../src/configuration/configuration.module';
import {
  loadAppConfig,
  type AppConfig,
} from '../../../src/configuration/configuration/configuration.service';
import { DatabaseModule } from '../../../src/database/database.module';
import { PrismaService } from '../../../src/database/prisma/prisma.service';
import { createAekoAuth } from '../../../src/lib/auth/auth.config';
import { RedisConnectionsService } from '../../../src/realtime/redis-connections.service';
import { RealtimeModule } from '../../../src/realtime/realtime.module';
import { SocketIoRedisAdapter } from '../../../src/realtime/socket-io-redis.adapter';
import { PrismaClient } from '../../../dist/generated/prisma/client.js';

@Module({})
class ChatBenchmarkRootModule {
  static register(
    configuration: AppConfig,
    database: PrismaClient,
  ): DynamicModule {
    return {
      module: ChatBenchmarkRootModule,
      imports: [
        ConfigurationModule.register(configuration),
        DatabaseModule.register(configuration, database),
        AuthModule,
        RealtimeModule,
        ChatModule,
      ],
    };
  }
}

const main = async (): Promise<void> => {
  delete process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;
  delete process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;
  const configuration = loadAppConfig(process.env);
  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString: configuration.databaseUrl }),
  });
  const application = await NestFactory.create<NestExpressApplication>(
    ChatBenchmarkRootModule.register(configuration, database),
  );
  const auth = await createAekoAuth(
    application.get(PrismaService).adapterClient,
    configuration,
  );
  application.get(AuthRuntimeService).initialize(auth);
  await application.get(RedisConnectionsService).connect();
  application.useWebSocketAdapter(application.get(SocketIoRedisAdapter));
  await application.listen(configuration.port);

  const shutdown = async (): Promise<void> => {
    await application.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
};

void main();
