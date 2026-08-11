import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FlutterwavePort } from '../providers/flutterwave/flutterwave.port';
import { HttpFlutterwaveAdapter } from '../providers/flutterwave/http-flutterwave.adapter';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: FlutterwavePort, useClass: HttpFlutterwaveAdapter },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
