import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import {
  parseDebateListQuery,
  type DebatePage,
  type DebateView,
} from './debate.contract';
import { DebatesService } from './debates.service';

@Controller('api/debates')
export class DebatesController {
  constructor(private readonly debates: DebatesService) {}

  @Post('start')
  @UseGuards(SessionGuard)
  start(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly debate: DebateView }> {
    return this.debates.start(principal, body);
  }

  @Put(':debateId/score')
  @UseGuards(SessionGuard)
  score(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('debateId') debateId: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly score: number }> {
    return this.debates.score(principal, debateId, body);
  }

  @Put(':debateId/vote')
  @UseGuards(SessionGuard)
  vote(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('debateId') debateId: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.debates.vote(principal, debateId, body);
  }

  @Put(':debateId/end')
  @UseGuards(SessionGuard)
  end(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('debateId') debateId: string,
    @Body() body: unknown,
  ): Promise<{
    readonly success: true;
    readonly message: string;
    readonly debate: DebateView;
  }> {
    return this.debates.end(principal, debateId, body);
  }

  /**
   * Deliberately public. Every other debate route requires a session, but this
   * listing never did, and requiring one would break anonymous clients.
   */
  @Get()
  list(@Query() query: unknown): Promise<DebatePage> {
    return this.debates.list(parseDebateListQuery(query));
  }
}
