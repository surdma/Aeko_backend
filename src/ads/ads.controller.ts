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
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import {
  parseAdListQuery,
  parseAdTargetedQuery,
  parseDashboardQuery,
  type AdAnalyticsView,
  type AdDashboard,
  type AdPage,
  type AdView,
  type TargetedAds,
} from './ad.contract';
import { AdsService } from './ads.service';

@Controller('api/ads')
@UseGuards(SessionGuard)
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<AdView> {
    return this.ads.create(principal, body);
  }

  @Get()
  listOwned(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<AdPage> {
    return this.ads.listOwned(principal, parseAdListQuery(query));
  }

  @Get('targeted')
  targeted(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<TargetedAds> {
    return this.ads.targeted(principal, parseAdTargetedQuery(query));
  }

  @Get('dashboard')
  dashboard(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<AdDashboard> {
    return this.ads.dashboard(principal, parseDashboardQuery(query));
  }

  @Get(':adId/analytics')
  analytics(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('adId') adId: string,
  ): Promise<AdAnalyticsView> {
    return this.ads.analytics(principal, adId);
  }

  @Put(':adId')
  updateOwned(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('adId') adId: string,
    @Body() body: unknown,
  ): Promise<AdView> {
    return this.ads.updateOwned(principal, adId, body);
  }

  @Delete(':adId')
  @UseGuards(SessionGuard, TwoFactorGuard)
  deleteOwned(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('adId') adId: string,
  ): Promise<{ readonly deleted: true }> {
    return this.ads.deleteOwned(principal, adId);
  }
}
