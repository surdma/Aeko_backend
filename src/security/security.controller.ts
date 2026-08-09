import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { parsePageQuery } from '../common/pagination/page-query';
import type { UserPage } from '../users/user.contract';
import {
  parseBlockReason,
  parseFollowRequestAction,
  parseFollowRequestQuery,
  parseSecurityEventQuery,
  parseSecurityStatsDays,
  parseSocialUserId,
  type FollowRequestPage,
  type PrivacySettings,
  type SecurityEventPage,
  type SecurityEventStats,
} from './security.contract';
import { SecurityEventService } from './security-event.service';
import {
  SecurityService,
  type BlockResult,
  type BlockStatus,
  type FollowResolution,
  type FollowState,
} from './security.service';

@Controller('api/security')
@UseGuards(SessionGuard)
export class SecurityController {
  constructor(
    private readonly security: SecurityService,
    private readonly events: SecurityEventService,
  ) {}

  @Get('events')
  securityEvents(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<SecurityEventPage> {
    return this.events.list(principal.userId, parseSecurityEventQuery(query));
  }

  @Get('stats')
  securityStats(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query('days') days: unknown,
  ): Promise<SecurityEventStats> {
    return this.events.stats(principal.userId, parseSecurityStatsDays(days));
  }

  @Post('block/:userId')
  block(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<BlockResult> {
    return this.security.block(
      principal.userId,
      parseSocialUserId(userId),
      parseBlockReason(body),
    );
  }

  @Delete('block/:userId')
  unblock(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId') userId: string,
  ): Promise<BlockResult> {
    return this.security.unblock(principal.userId, parseSocialUserId(userId));
  }

  @Get('blocked')
  blocked(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<UserPage> {
    return this.security.blocked(principal.userId, parsePageQuery(query));
  }

  @Get('block-status/:userId')
  blockStatus(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId') userId: string,
  ): Promise<BlockStatus> {
    return this.security.blockStatus(
      principal.userId,
      parseSocialUserId(userId),
    );
  }

  @Put('privacy')
  updatePrivacy(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<PrivacySettings> {
    return this.security.updatePrivacy(principal.userId, body);
  }

  @Get('privacy')
  privacy(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<PrivacySettings> {
    return this.security.privacy(principal.userId);
  }

  @Post('follow-request/:userId')
  requestFollow(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId') userId: string,
  ): Promise<FollowState> {
    return this.security.requestFollow(
      principal.userId,
      parseSocialUserId(userId),
    );
  }

  @Put('follow-request/:requesterId')
  resolveFollowRequest(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('requesterId') requesterId: string,
    @Body() body: unknown,
  ): Promise<FollowResolution> {
    return this.security.resolveFollowRequest(
      principal.userId,
      parseSocialUserId(requesterId),
      parseFollowRequestAction(body),
    );
  }

  @Get('follow-requests')
  followRequests(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<FollowRequestPage> {
    return this.security.followRequests(
      principal.userId,
      parseFollowRequestQuery(query),
    );
  }
}
