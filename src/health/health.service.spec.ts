import { Test, type TestingModule } from '@nestjs/testing';
import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('maps a failed database probe to a sanitized DomainError', async () => {
    const prisma = {
      assertReady: async () => {
        throw new Error('raw database failure');
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get<HealthService>(HealthService);

    await expect(service.readiness()).rejects.toEqual(
      new DomainError(
        'DATABASE_UNAVAILABLE',
        'The service is temporarily unavailable.',
      ),
    );
  });
});
