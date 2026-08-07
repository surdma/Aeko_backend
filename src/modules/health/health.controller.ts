import { Controller, Get } from '@nestjs/common';
import { PublicRoute } from '../../common/authentication/public-route.decorator.js';
import { HealthService, type HealthStatus } from './health.service.js';

@PublicRoute()
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
