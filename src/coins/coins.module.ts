import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HttpPaystackAdapter } from '../providers/paystack/http-paystack.adapter';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripeSdkAdapter } from '../providers/stripe/stripe-sdk.adapter';
import { StripePort } from '../providers/stripe/stripe.port';
import { CoinsController } from './coins.controller';
import { CoinsService } from './coins.service';

@Module({
  imports: [AuthModule],
  controllers: [CoinsController],
  providers: [
    CoinsService,
    { provide: PaystackPort, useClass: HttpPaystackAdapter },
    { provide: StripePort, useClass: StripeSdkAdapter },
  ],
  exports: [CoinsService],
})
export class CoinsModule {}
