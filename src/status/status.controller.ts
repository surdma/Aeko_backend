import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { parseStatusListQuery, type StatusView } from './status.contract';
import { StatusService } from './status.service';

@Controller('api/status')
@UseGuards(SessionGuard)
export class StatusController {
  constructor(private readonly statuses: StatusService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<StatusView> {
    return this.statuses.create(principal, body);
  }

  @Get()
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<readonly StatusView[]> {
    return this.statuses.list(principal, parseStatusListQuery(query));
  }

  @Delete(':id')
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.statuses.remove(principal, id);
  }

  @Post(':id/react')
  @HttpCode(HttpStatus.OK)
  react(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.statuses.react(principal, id, body);
  }

  @Post(':id/reshare')
  @HttpCode(HttpStatus.CREATED)
  reshare(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<StatusView> {
    return this.statuses.reshare(principal, id, body);
  }
}
