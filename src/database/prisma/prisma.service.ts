import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

export interface PrismaLifecycleClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw(query: TemplateStringsArray): Promise<unknown>;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly client: PrismaLifecycleClient,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async assertReady(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
