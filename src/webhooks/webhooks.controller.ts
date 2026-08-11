import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { WebhooksService } from './webhooks.service';

/**
 * Both routes are authenticated by provider signature rather than by session,
 * so no guard applies. They answer 200 for anything they understood — including
 * events they deliberately ignore — and a 4xx or 5xx otherwise, which is what
 * tells the provider to redeliver.
 */
@Controller('api/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async paystack(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ): Promise<{ readonly received: true }> {
    await this.webhooks.handlePaystack(request.rawBody, signature);
    return Object.freeze({ received: true as const });
  }

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async stripe(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ readonly received: true }> {
    await this.webhooks.handleStripe(request.rawBody, signature);
    return Object.freeze({ received: true as const });
  }
}
