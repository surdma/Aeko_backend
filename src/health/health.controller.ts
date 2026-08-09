import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthService,
  type LivenessBody,
  type ReadinessBody,
} from './health.service';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  liveness(): LivenessBody {
    return this.healthService.liveness();
  }

  @Get('ready')
  readiness(): Promise<ReadinessBody> {
    return this.healthService.readiness();
  }
}
