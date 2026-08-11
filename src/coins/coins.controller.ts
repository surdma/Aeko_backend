import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import {
  CoinsService,
  type CoinCreditResult,
  type CoinPurchaseInitialization,
} from './coins.service';
import type { CoinHistoryPage, CoinPackage } from './coin.contract';

@Controller('api/coins')
export class CoinsController {
  constructor(private readonly coins: CoinsService) {}

  /** Public: the catalogue is a price list, and legacy served it unguarded. */
  @Get('packages')
  packages(): {
    readonly success: true;
    readonly data: readonly CoinPackage[];
  } {
    return this.coins.packages();
  }

  @Get('balance')
  @UseGuards(SessionGuard)
  balance(@CurrentUser() principal: AuthenticatedPrincipal): Promise<{
    readonly success: true;
    readonly data: Readonly<{ coinBalance: number }>;
  }> {
    return this.coins.balance(principal);
  }

  @Get('history')
  @UseGuards(SessionGuard)
  history(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<{ readonly success: true; readonly data: CoinHistoryPage }> {
    return this.coins.history(principal, query);
  }

  @Post('purchase')
  @UseGuards(SessionGuard)
  purchase(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<CoinPurchaseInitialization> {
    return this.coins.purchase(principal, body);
  }

  /**
   * Public, exactly as legacy had it: Paystack redirects the payer straight
   * here and no session cookie survives the round trip.
   */
  @Get('purchase/verify')
  verifyPaystack(@Query() query: unknown): Promise<CoinCreditResult> {
    return this.coins.verifyPaystack(query);
  }

  @Post('purchase/verify-stripe')
  @UseGuards(SessionGuard)
  verifyStripe(@Body() body: unknown): Promise<CoinCreditResult> {
    return this.coins.verifyStripe(body);
  }
}
