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

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import {
  parseChallengeListQuery,
  type ChallengePage,
  type ChallengeView,
} from './challenge.contract';
import { ChallengesService } from './challenges.service';

@Controller('api/challenges')
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Post('create')
  @UseGuards(SessionGuard)
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly challenge: ChallengeView }> {
    return this.challenges.create(principal, body);
  }

  @Put(':challengeId/duet')
  @UseGuards(SessionGuard)
  duet(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('challengeId') challengeId: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.challenges.duet(principal, challengeId, body);
  }

  @Put(':challengeId/vote')
  @UseGuards(SessionGuard)
  vote(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('challengeId') challengeId: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.challenges.vote(principal, challengeId, body);
  }

  @Put(':challengeId/end')
  @UseGuards(SessionGuard)
  end(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('challengeId') challengeId: string,
    @Body() body: unknown,
  ): Promise<{
    readonly success: true;
    readonly message: string;
    readonly challenge: ChallengeView;
  }> {
    return this.challenges.end(principal, challengeId, body);
  }

  /** Deliberately public, as Express left it. */
  @Get()
  list(@Query() query: unknown): Promise<ChallengePage> {
    return this.challenges.list(parseChallengeListQuery(query));
  }
}
