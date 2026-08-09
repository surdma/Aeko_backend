import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { parsePageQuery } from '../common/pagination/page-query';
import {
  type ProfileActivityPage,
  type ProfileEligibility,
  type UserProfile,
} from './profile.contract';
import { ProfilesService } from './profiles.service';

@Controller('api/profile')
@UseGuards(SessionGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  getProfile(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<UserProfile> {
    return this.profiles.getProfile(principal.userId);
  }

  @Get('activity')
  activity(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<ProfileActivityPage> {
    return this.profiles.getActivity(principal.userId, parsePageQuery(query));
  }

  @Put('update')
  @UseGuards(TwoFactorGuard)
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<UserProfile> {
    return this.profiles.updateProfile(principal.userId, body);
  }

  @Get('eligibility')
  eligibility(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ProfileEligibility> {
    return this.profiles.getEligibility(principal.userId);
  }
}
