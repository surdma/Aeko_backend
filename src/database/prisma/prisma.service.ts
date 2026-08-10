import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

/**
 * The subset of the generated client the application lifecycle depends on.
 * Kept narrow so `createApplication({ databaseClient })` can accept a
 * lifecycle-only double in tests that never issue model queries.
 */
export interface PrismaLifecycleClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw(query: TemplateStringsArray): Promise<unknown>;
}

/**
 * Transaction-capable query surface. Prisma's interactive transaction callback
 * receives a client without `$transaction`/`$connect`, so repositories that run
 * inside and outside a transaction accept this narrower type.
 */
export type PrismaTransaction = Prisma.TransactionClient;

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

  /**
   * The typed generated client used by every repository.
   *
   * The injection token is declared as `PrismaLifecycleClient` so tests can
   * supply a lifecycle-only double, so the widening happens here — one cast at
   * the composition seam instead of untyped reflection in every repository.
   */
  get db(): PrismaClient {
    return this.client as PrismaClient;
  }

  /**
   * Better Auth's Prisma adapter takes an untyped client instance.
   */
  get adapterClient(): object {
    return this.client;
  }
}
