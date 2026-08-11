import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import type { JsonValue } from '../common/json/json-value';
import { PaymentsService } from './payments.service';

@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('pay')
  @UseGuards(SessionGuard, TwoFactorGuard)
  initiate(@Body() body: unknown): Promise<JsonValue> {
    return this.payments.initiate(body);
  }

  @Get('verify')
  @UseGuards(SessionGuard)
  verify(@Query() query: unknown): Promise<{
    readonly message: string;
    readonly data: JsonValue;
  }> {
    return this.payments.verify(query);
  }
}
