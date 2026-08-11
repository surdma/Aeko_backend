import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { RoleGuard } from '../auth/guards/role/role.guard';
import { SessionGuard } from '../auth/guards/session/session.guard';
import type { SubscriptionPlanView } from '../subscriptions/subscription.contract';
import { SubscriptionPlansService } from './subscription-plans.service';

@Controller('api/subscription-plans')
export class SubscriptionPlansController {
  constructor(private readonly plans: SubscriptionPlansService) {}

  /** Public, as legacy had it. */
  @Get()
  list(): Promise<{
    readonly success: true;
    readonly data: readonly SubscriptionPlanView[];
  }> {
    return this.plans.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, RoleGuard)
  create(@Body() body: unknown): Promise<{
    readonly success: true;
    readonly data: SubscriptionPlanView;
  }> {
    return this.plans.create(body);
  }

  @Put(':id')
  @UseGuards(SessionGuard, RoleGuard)
  update(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly data: SubscriptionPlanView }> {
    return this.plans.update(id, body);
  }

  @Delete(':id')
  @UseGuards(SessionGuard, RoleGuard)
  deactivate(@Param('id') id: string): Promise<{
    readonly success: true;
    readonly message: string;
    readonly data: SubscriptionPlanView;
  }> {
    return this.plans.deactivate(id);
  }
}
