import { Module } from '@nestjs/common';

import { CommunityPaymentPort } from '../providers/community-payment/community-payment.port';
import { UnavailableCommunityPaymentAdapter } from '../providers/community-payment/unavailable-community-payment.adapter';
import { HttpPaystackAdapter } from '../providers/paystack/http-paystack.adapter';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripeSdkAdapter } from '../providers/stripe/stripe-sdk.adapter';
import { StripePort } from '../providers/stripe/stripe.port';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [SubscriptionsModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    { provide: PaystackPort, useClass: HttpPaystackAdapter },
    { provide: StripePort, useClass: StripeSdkAdapter },
    {
      provide: CommunityPaymentPort,
      useClass: UnavailableCommunityPaymentAdapter,
    },
  ],
})
export class WebhooksModule {}
