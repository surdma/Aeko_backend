import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';

export interface LivenessBody {
  readonly success: true;
  readonly status: 'live';
}

export interface ReadinessBody {
  readonly success: true;
  readonly status: 'ready';
  readonly checks: Readonly<{ database: 'up' }>;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  liveness(): LivenessBody {
    return { success: true, status: 'live' };
  }

  async readiness(): Promise<ReadinessBody> {
    try {
      await this.prisma.assertReady();
    } catch {
      throw new DomainError(
        'DATABASE_UNAVAILABLE',
        'The service is temporarily unavailable.',
      );
    }
    return {
      success: true,
      status: 'ready',
      checks: { database: 'up' },
    };
  }
}
