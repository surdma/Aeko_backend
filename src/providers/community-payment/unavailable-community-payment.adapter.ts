import { Injectable } from '@nestjs/common';

import { DomainError } from '../../common/errors/domain.error';
import { CommunityPaymentPort } from './community-payment.port';

/**
 * Installed until the `communities` domain lands its settlement service.
 *
 * It reports the capability as unavailable rather than acknowledging an event
 * it cannot act on. That answers the provider with a retryable failure, so a
 * community payment stays queued for redelivery instead of being silently
 * dropped — but the provider's retry window is finite, so this adapter must be
 * replaced before the legacy community routes are cut over.
 */
@Injectable()
export class UnavailableCommunityPaymentAdapter extends CommunityPaymentPort {
  settle(transactionId: string): Promise<void> {
    void transactionId;
    return Promise.reject(
      new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Community payment settlement is not available yet.',
      ),
    );
  }
}
