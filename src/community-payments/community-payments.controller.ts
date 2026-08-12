import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import {
  CommunityPaymentsService,
  type CommunityPaymentInitialization,
  type CommunityPaymentVerification,
  type WithdrawalResult,
} from './community-payments.service';
import type { CommunityTransactionPage } from './community-payment.contract';

@Controller('api/community/payment')
export class CommunityPaymentsController {
  constructor(private readonly payments: CommunityPaymentsService) {}

  @Post('initialize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  initialize(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<CommunityPaymentInitialization> {
    return this.payments.initialize(principal, body);
  }

  /**
   * Public, exactly as legacy had it: the provider redirects the payer here
   * and no session cookie survives the round trip.
   */
  @Get('verify')
  verify(@Query() query: unknown): Promise<CommunityPaymentVerification> {
    return this.payments.verify(query);
  }

  /** Owner-only, enforced in the service, with a second factor at the door. */
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, TwoFactorGuard)
  withdraw(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<WithdrawalResult> {
    return this.payments.withdraw(principal, body);
  }

  @Get(':communityId/transactions')
  @UseGuards(SessionGuard)
  listTransactions(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('communityId') communityId: string,
    @Query() query: unknown,
  ): Promise<CommunityTransactionPage> {
    return this.payments.listTransactions(principal, communityId, query);
  }
}
