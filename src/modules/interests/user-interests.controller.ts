import { Body, Controller, Delete, Get, InternalServerErrorException, NotFoundException, Param, Post, BadRequestException, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator.js';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { userInterestIdsSchema, type UserInterestIdsBody } from './interest.schemas.js';
import { InterestsService, type UserInterestsResult } from './interests.service.js';

function failure(message: string): Readonly<{ success: false; message: string }> {
  return { success: false, message };
}

@Controller('api/user/interests')
@UseGuards(ThrottlerGuard, JwtAuthGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
@Throttle({ default: { limit: 100, ttl: minutes(15) } })
export class UserInterestsController {
  public constructor(private readonly service: InterestsService) {}

  @Get()
  public async list(@CurrentUserId() userId: string): Promise<Readonly<{ success: true; data: unknown }>> {
    return this.response(await this.service.listForUser(userId), 'fetch');
  }

  @Post()
  public async add(
    @CurrentUserId() userId: string,
    @Body(new ZodBodyPipe(userInterestIdsSchema, 'One or more interest IDs are invalid'))
    body: UserInterestIdsBody,
  ): Promise<Readonly<{ success: true; message: string; data: unknown }>> {
    const result = await this.service.addForUser(userId, body.interestIds);
    const response = this.response(result, 'update');
    return { ...response, message: 'Interests updated successfully' };
  }

  @Delete(':interestId')
  public async remove(
    @CurrentUserId() userId: string,
    @Param('interestId') interestId: string,
  ): Promise<Readonly<{ success: true; message: string; data: unknown }>> {
    const result = await this.service.removeForUser(userId, interestId);
    const response = this.response(result, 'remove');
    return { ...response, message: 'Interest removed successfully' };
  }

  private response(
    result: UserInterestsResult,
    operation: 'fetch' | 'update' | 'remove',
  ): Readonly<{ success: true; data: unknown }> {
    if (result.kind === 'user-not-found') throw new NotFoundException(failure('User not found'));
    if (result.kind === 'invalid-interest-ids') {
      throw new BadRequestException(failure('One or more interest IDs are invalid'));
    }
    if (result.kind === 'interest-not-found') {
      throw new NotFoundException(failure('Interest not found in user interests'));
    }
    if (result.kind === 'unexpected') {
      const message = operation === 'fetch'
        ? 'Error fetching user interests'
        : operation === 'update'
          ? 'Error updating interests'
          : 'Error removing interest';
      throw new InternalServerErrorException(failure(message));
    }
    return { success: true, data: result.data };
  }
}
