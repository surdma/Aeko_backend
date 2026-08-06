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
import type { WaitlistEntry } from '@prisma/client';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import {
  JoinWaitlistPipe,
  type JoinWaitlistInput,
} from './join-waitlist.pipe.js';
import { WaitlistService, type JoinWaitlistResult } from './waitlist.service.js';
import { WaitlistThrottlerExceptionFilter } from './waitlist-throttler-exception.filter.js';

interface JoinWaitlistSuccessResponse {
  readonly success: true;
  readonly message: 'Joined waitlist successfully';
  readonly data: WaitlistEntry;
}

function legacyFailure(message: string): Readonly<{ success: false; message: string }> {
  return { success: false, message };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled waitlist result: ${JSON.stringify(value)}`);
}

@Controller('api/waitlist')
@UseGuards(ThrottlerGuard)
@UseFilters(WaitlistThrottlerExceptionFilter)
export class WaitlistController {
  public constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 100, ttl: minutes(15) } })
  public async join(
    @Body(JoinWaitlistPipe) input: JoinWaitlistInput,
  ): Promise<JoinWaitlistSuccessResponse> {
    const result = await this.waitlistService.join(input);
    return this.toHttpResponse(result);
  }

  private toHttpResponse(result: JoinWaitlistResult): JoinWaitlistSuccessResponse {
    switch (result.kind) {
      case 'created':
        return {
          success: true,
          message: 'Joined waitlist successfully',
          data: result.entry,
        };
      case 'duplicate':
        throw new ConflictException(
          legacyFailure('This email is already on the waitlist'),
        );
      case 'database-unavailable':
        throw new ServiceUnavailableException(
          legacyFailure(
            'Waitlist is temporarily unavailable. Please try again shortly.',
          ),
        );
      case 'unexpected':
        throw new InternalServerErrorException(
          legacyFailure('Error joining waitlist'),
        );
      default:
        return assertNever(result);
    }
  }
}
