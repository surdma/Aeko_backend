import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import { RoleGuard } from '../auth/guards/role/role.guard';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { parsePageQuery } from '../common/pagination/page-query';
import {
  RequestAudit,
  type RequestAuditContext,
} from '../common/http/request-audit/request-audit.decorator';
import { parseUserSearch, type UserPage } from '../users/user.contract';
import type { FollowState } from '../security/security.service';
import {
  parseSocialUserId,
  parseVerificationTarget,
} from '../security/security.contract';
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

  @Post('verify')
  @UseGuards(RoleGuard, TwoFactorGuard)
  verify(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @RequestAudit() audit: RequestAuditContext,
  ): Promise<{ readonly verified: true }> {
    return this.profiles.verifyUser(
      principal,
      parseVerificationTarget(body),
      audit,
    );
  }

  @Get('followers')
  followers(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<UserPage> {
    return this.profiles.followers(principal.userId, parsePageQuery(query));
  }

  @Get('following')
  following(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<UserPage> {
    return this.profiles.following(principal.userId, parsePageQuery(query));
  }

  @Get('followers/search')
  searchFollowers(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<UserPage> {
    return this.profiles.searchFollowers(principal.userId, {
      ...parsePageQuery(query),
      ...parseUserSearch(query),
    });
  }

  @Put('follow/:id')
  follow(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<FollowState> {
    return this.profiles.follow(principal.userId, parseSocialUserId(id));
  }

  @Put('unfollow/:id')
  unfollow(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly state: 'not-following' }> {
    return this.profiles.unfollow(principal.userId, parseSocialUserId(id));
  }
}
