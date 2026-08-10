import {
  Body,
  Controller,
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
import { RoleGuard } from '../auth/guards/role/role.guard';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import { parseReportListQuery, type ReportView } from './report.contract';
import {
  ReportsService,
  type BanResult,
  type ReportListResult,
  type WarnResult,
} from './reports.service';

@Controller('api/reports')
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly report: ReportView }> {
    return this.reports.create(principal, body);
  }

  @Get()
  @UseGuards(SessionGuard, RoleGuard)
  listForReview(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<ReportListResult> {
    return this.reports.listForReview(principal, parseReportListQuery(query));
  }

  @Post(':userId/warn')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RoleGuard, TwoFactorGuard)
  warn(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<WarnResult> {
    return this.reports.warn(principal, userId, body);
  }

  @Post(':userId/ban')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RoleGuard, TwoFactorGuard)
  ban(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<BanResult> {
    return this.reports.ban(principal, userId, body);
  }
}
