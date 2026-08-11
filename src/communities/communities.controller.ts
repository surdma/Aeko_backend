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
import { CommunitiesService, type JoinResult } from './communities.service';
import type {
  CommunityDetailView,
  CommunityPage,
  CommunityView,
} from './community.contract';

@Controller('api/communities')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, TwoFactorGuard)
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly data: CommunityView }> {
    return this.communities.create(principal, body);
  }

  /** Public, as legacy had it. */
  @Get()
  list(@Query() query: unknown): Promise<CommunityPage> {
    return this.communities.list(query);
  }

  /**
   * Declared before `:id` so the literal segment wins the route match; Express
   * resolved it the same way by declaration order.
   */
  @Get('my')
  @UseGuards(SessionGuard)
  listMine(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<CommunityPage> {
    return this.communities.listMine(principal, query);
  }

  @Get(':id')
  @UseGuards(SessionGuard)
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly success: true; readonly data: CommunityDetailView }> {
    return this.communities.get(principal, id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  join(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<JoinResult> {
    return this.communities.join(principal, id);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  leave(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.communities.leave(principal, id);
  }

  /** Authorization is owner-or-moderator and lives in the service. */
  @Put(':id')
  @UseGuards(SessionGuard)
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly data: CommunityView }> {
    return this.communities.update(principal, id, body);
  }

  @Delete(':id')
  @UseGuards(SessionGuard, TwoFactorGuard)
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.communities.remove(principal, id);
  }
}
