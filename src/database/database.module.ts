import { DynamicModule, Module, Provider } from '@nestjs/common';
import type { AppConfig } from '../configuration/configuration/configuration.service';
import {
  PRISMA_CLIENT,
  type PrismaLifecycleClient,
  PrismaService,
} from './prisma/prisma.service';

@Module({})
export class DatabaseModule {
  static register(
    configuration: AppConfig,
    client?: PrismaLifecycleClient,
  ): DynamicModule {
    const clientProvider: Provider = client
      ? { provide: PRISMA_CLIENT, useValue: client }
      : {
          provide: PRISMA_CLIENT,
          useFactory: () => createPrismaClient(configuration.databaseUrl),
        };
    return {
      module: DatabaseModule,
      global: true,
      providers: [clientProvider, PrismaService],
      exports: [PrismaService],
    };
  }
}

async function createPrismaClient(
  connectionString: string,
): Promise<PrismaLifecycleClient> {
  const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
    import('@prisma/adapter-pg'),
    import('../../prisma/generated/client.js'),
  ]);
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}
