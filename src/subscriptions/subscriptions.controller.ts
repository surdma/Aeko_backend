import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { RoleGuard } from '../auth/guards/role/role.guard';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import {
  SubscriptionsService,
  type SubscriptionInitialization,
  type SubscriptionVerification,
} from './subscriptions.service';
import type {
  SubscriberPage,
  SubscriptionStats,
  SubscriptionStatusView,
} from './subscription.contract';

@Controller('api/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('admin/all')
  @UseGuards(SessionGuard, RoleGuard)
  listSubscribers(@Query() query: unknown): Promise<SubscriberPage> {
    return this.subscriptions.listSubscribers(query);
  }

  @Get('admin/stats')
  @UseGuards(SessionGuard, RoleGuard)
  stats(): Promise<SubscriptionStats> {
    return this.subscriptions.stats();
  }

  @Post('initialize')
  @UseGuards(SessionGuard, TwoFactorGuard)
  initialize(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<{
    readonly success: true;
    readonly data: SubscriptionInitialization;
  }> {
    return this.subscriptions.initialize(principal, body);
  }

  /**
   * Public, exactly as legacy had it: the provider's callback URL lands here
   * without a session cookie.
   */
  @Get('verify')
  verify(@Query() query: unknown): Promise<{
    readonly success: true;
    readonly data: SubscriptionVerification;
  }> {
    return this.subscriptions.verify(query);
  }

  @Get('status')
  @UseGuards(SessionGuard)
  status(@CurrentUser() principal: AuthenticatedPrincipal): Promise<{
    readonly success: true;
    readonly data: SubscriptionStatusView | null;
  }> {
    return this.subscriptions.status(principal);
  }
}
