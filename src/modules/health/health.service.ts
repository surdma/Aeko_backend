import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export interface HealthStatus {
  readonly status: 'ok' | 'ready';
  readonly timestamp: string;
}

@Injectable()
export class HealthService {
  public constructor(private readonly prisma: PrismaService) {}

  public liveness(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  public async readiness(): Promise<HealthStatus> {
    try {
      await this.prisma.verifyConnection();
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is not ready',
        details: null,
      });
    }
    return { status: 'ready', timestamp: new Date().toISOString() };
  }
}
