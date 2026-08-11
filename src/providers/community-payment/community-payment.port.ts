/**
 * Settlement of a community payment.
 *
 * Community payments belong to the `communities` domain (programme order 6),
 * which has not been migrated yet. The webhooks land first, because both
 * providers deliver subscription and community events down the same two URLs,
 * so the dispatch is migrated against this port and the real adapter arrives
 * with that domain.
 */
export abstract class CommunityPaymentPort {
  abstract settle(transactionId: string): Promise<void>;
}
