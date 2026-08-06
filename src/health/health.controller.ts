import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service.js';

@Controller('health')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Get('live')
  public liveness(): HealthStatus {
    return this.healthService.liveness();
  }

  @Get('ready')
  public readiness(): Promise<HealthStatus> {
    return this.healthService.readiness();
  }
}
