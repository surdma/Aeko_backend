import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HttpPaystackAdapter } from '../providers/paystack/http-paystack.adapter';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripeSdkAdapter } from '../providers/stripe/stripe-sdk.adapter';
import { StripePort } from '../providers/stripe/stripe.port';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    { provide: PaystackPort, useClass: HttpPaystackAdapter },
    { provide: StripePort, useClass: StripeSdkAdapter },
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
