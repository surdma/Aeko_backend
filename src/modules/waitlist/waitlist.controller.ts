import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
  ServiceUnavailableException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import { JoinWaitlistPipe, type JoinWaitlistInput } from './join-waitlist.pipe.js';
import { WaitlistService, type JoinWaitlistResult } from './waitlist.service.js';
import type { WaitlistEntryRecord } from './waitlist.repository.js';

interface JoinWaitlistSuccessResponse {
  readonly success: true;
  readonly message: 'Joined waitlist successfully';
  readonly data: WaitlistEntryRecord;
}

function failure(message: string): Readonly<{ success: false; message: string }> {
  return { success: false, message };
}

@Controller('api/waitlist')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class WaitlistController {
  public constructor(private readonly service: WaitlistService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 100, ttl: minutes(15) } })
  public async join(@Body(JoinWaitlistPipe) input: JoinWaitlistInput): Promise<JoinWaitlistSuccessResponse> {
    return this.toResponse(await this.service.join(input));
  }

  private toResponse(result: JoinWaitlistResult): JoinWaitlistSuccessResponse {
    switch (result.kind) {
      case 'created':
        return { success: true, message: 'Joined waitlist successfully', data: result.entry };
      case 'duplicate':
        throw new ConflictException(failure('This email is already on the waitlist'));
      case 'database-unavailable':
        throw new ServiceUnavailableException(
          failure('Waitlist is temporarily unavailable. Please try again shortly.'),
        );
      case 'unexpected':
        throw new InternalServerErrorException(failure('Error joining waitlist'));
    }
  }
}
