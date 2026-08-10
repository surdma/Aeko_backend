import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import {
  ExploreService,
  parseExploreQuery,
  type ExploreResult,
} from './explore.service';

@Controller('api/explore')
@UseGuards(SessionGuard)
export class ExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get()
  feed(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<ExploreResult> {
    return this.explore.feed(principal, parseExploreQuery(query));
  }
}
