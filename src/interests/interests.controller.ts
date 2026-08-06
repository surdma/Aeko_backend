import {
  Controller,
  Get,
  InternalServerErrorException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Interest } from '@prisma/client';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { LegacyApiThrottlerExceptionFilter } from '../common/legacy-api-throttler-exception.filter.js';
import {
  InterestsService,
  type ListActiveInterestsResult,
} from './interests.service.js';

interface ListActiveInterestsResponse {
  readonly success: true;
  readonly data: readonly Interest[];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled interests result: ${JSON.stringify(value)}`);
}

@Controller('api/interests')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class InterestsController {
  public constructor(private readonly interestsService: InterestsService) {}

  @Get()
  @Throttle({ default: { limit: 100, ttl: minutes(15) } })
  public async listActive(): Promise<ListActiveInterestsResponse> {
    const result = await this.interestsService.listActive();
    return this.toHttpResponse(result);
  }

  private toHttpResponse(
    result: ListActiveInterestsResult,
  ): ListActiveInterestsResponse {
    switch (result.kind) {
      case 'loaded':
        return {
          success: true,
          data: result.interests,
        };
      case 'unexpected':
        throw new InternalServerErrorException({
          success: false,
          message: 'Error fetching interests',
        });
      default:
        return assertNever(result);
    }
  }
}
