import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { TwoFactorGuard } from '../auth/guards/two-factor.guard.js';
import {
  createInterestSchema,
  type CreateInterestBody,
  updateInterestSchema,
  type UpdateInterestBody,
} from './interest.schemas.js';
import {
  InterestsService,
  type InterestResult,
} from './interests.service.js';

function failure(message: string): Readonly<{ success: false; message: string }> {
  return { success: false, message };
}

@Controller('api/interests')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
@Throttle({ default: { limit: 100, ttl: minutes(15) } })
export class InterestsController {
  public constructor(private readonly service: InterestsService) {}

  @Get()
  public async list(): Promise<Readonly<{ success: true; data: unknown }>> {
    const result = await this.service.listActive();
    if (result.kind === 'unexpected') {
      throw new InternalServerErrorException(
        failure('Error fetching interests'),
      );
    }
    return { success: true, data: result.data };
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard, TwoFactorGuard)
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @Body(
      new ZodBodyPipe(
        createInterestSchema,
        'Name and displayName are required',
      ),
    )
    input: CreateInterestBody,
  ): Promise<Readonly<{ success: true; data: unknown }>> {
    return this.interestResponse(await this.service.create(input), 'create');
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, AdminGuard, TwoFactorGuard)
  public async update(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateInterestSchema, 'Invalid interest update'))
    input: UpdateInterestBody,
  ): Promise<Readonly<{ success: true; data: unknown }>> {
    return this.interestResponse(await this.service.update(id, input), 'update');
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard, TwoFactorGuard)
  public async remove(
    @Param('id') id: string,
  ): Promise<Readonly<{ success: true; message: string }>> {
    const result = await this.service.delete(id);
    if (result.kind === 'not-found') {
      throw new NotFoundException(failure('Interest not found'));
    }
    if (result.kind === 'unexpected') {
      throw new InternalServerErrorException(
        failure('Error deleting interest'),
      );
    }
    return { success: true, message: 'Interest deleted successfully' };
  }

  private interestResponse(
    result: InterestResult,
    operation: 'create' | 'update',
  ): Readonly<{ success: true; data: unknown }> {
    if (result.kind === 'duplicate') {
      throw new ConflictException(
        failure('Interest with this name already exists'),
      );
    }
    if (result.kind === 'not-found') {
      throw new NotFoundException(failure('Interest not found'));
    }
    if (result.kind === 'unexpected') {
      throw new InternalServerErrorException(
        failure(
          operation === 'create'
            ? 'Error creating interest'
            : 'Error updating interest',
        ),
      );
    }
    return { success: true, data: result.data };
  }
}
