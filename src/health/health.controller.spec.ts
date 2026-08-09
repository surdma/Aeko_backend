import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('returns the liveness contract', async () => {
    const health = {
      liveness: () => ({ success: true, status: 'live' }),
      readiness: async () => ({
        success: true,
        status: 'ready',
        checks: { database: 'up' },
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
    }).compile();

    const controller = module.get<HealthController>(HealthController);

    expect(controller.liveness()).toEqual({ success: true, status: 'live' });
  });
});
