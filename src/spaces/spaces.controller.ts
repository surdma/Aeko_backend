import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import type { SpaceView } from './space.contract';
import { SpacesService } from './spaces.service';

@Controller('api/spaces')
@UseGuards(SessionGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Post('create')
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly space: SpaceView }> {
    return this.spaces.create(principal, body);
  }

  @Patch(':spaceId/end')
  end(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('spaceId') spaceId: string,
  ): Promise<{ readonly success: true; readonly space: SpaceView }> {
    return this.spaces.end(principal, spaceId);
  }

  @Put(':spaceId/highlight')
  addHighlight(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('spaceId') spaceId: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly space: SpaceView }> {
    return this.spaces.addHighlight(principal, spaceId, body);
  }
}
