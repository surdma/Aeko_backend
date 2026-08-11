/**
 * Settlement of a paid community membership.
 *
 * Both providers deliver subscription and community events down the same two
 * webhook URLs, so the payments domain owns the dispatch and this port is how
 * it hands a settled community payment on. The installed adapter implements the
 * legacy `handleCommunityPaymentSuccess` in full; initialising a community
 * payment and withdrawing earnings stay with the `communities` domain.
 */
export abstract class CommunityPaymentPort {
  /**
   * Idempotent: settling an already-settled transaction is a no-op, so a
   * redelivered webhook changes nothing.
   */
  abstract settle(transactionId: string): Promise<void>;
}
