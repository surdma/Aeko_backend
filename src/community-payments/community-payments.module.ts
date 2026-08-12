import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CommunityPaymentPort } from '../providers/community-payment/community-payment.port';
import { PrismaCommunityPaymentAdapter } from '../providers/community-payment/prisma-community-payment.adapter';
import { HttpPaystackAdapter } from '../providers/paystack/http-paystack.adapter';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripeSdkAdapter } from '../providers/stripe/stripe-sdk.adapter';
import { StripePort } from '../providers/stripe/stripe.port';
import { CommunityPaymentsController } from './community-payments.controller';
import { CommunityPaymentsService } from './community-payments.service';

@Module({
  imports: [AuthModule],
  controllers: [CommunityPaymentsController],
  providers: [
    CommunityPaymentsService,
    { provide: PaystackPort, useClass: HttpPaystackAdapter },
    { provide: StripePort, useClass: StripeSdkAdapter },
    // The same settlement the webhooks use, so a payment settles identically
    // whether it arrives by callback or by provider webhook.
    { provide: CommunityPaymentPort, useClass: PrismaCommunityPaymentAdapter },
  ],
  exports: [CommunityPaymentsService],
})
export class CommunityPaymentsModule {}
