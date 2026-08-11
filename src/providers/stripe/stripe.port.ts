import type { JsonValue } from '../../common/json/json-value';

/**
 * Stripe, reduced to the checkout, payment-intent and webhook calls the
 * payment routes make.
 *
 * Webhook signature verification is the reason the official package is a
 * dependency: reimplementing `constructEvent` correctly — payload, timestamp
 * tolerance, scheme, key rotation — is not a migration-sized job.
 */

export interface StripeCheckoutRequest {
  readonly productName: string;
  readonly description: string;
  readonly currency: string;
  /** Minor units, already rounded by the caller. */
  readonly amountMinor: number;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripeCheckoutSession {
  readonly id: string;
  readonly url: string | null;
}

export interface StripeRetrievedSession {
  readonly id: string;
  /** `paid` is the only state that may credit anything. */
  readonly paymentStatus: string;
  readonly amountTotalMinor: number | null;
  readonly currency: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripePaymentIntentRequest {
  readonly amountMinor: number;
  readonly currency: string;
  readonly description: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripePaymentIntent {
  readonly id: string;
  readonly clientSecret: string | null;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripeWebhookEvent {
  readonly type: string;
  /**
   * Metadata of the event's object, when it carries any. Events that do not
   * are not an error: they simply have nothing for us to dispatch on.
   */
  readonly metadata: Readonly<Record<string, string>>;
  readonly raw: JsonValue;
}

export abstract class StripePort {
  abstract createCheckoutSession(
    request: StripeCheckoutRequest,
  ): Promise<StripeCheckoutSession>;

  abstract retrieveSession(sessionId: string): Promise<StripeRetrievedSession>;

  abstract createPaymentIntent(
    request: StripePaymentIntentRequest,
  ): Promise<StripePaymentIntent>;

  abstract retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<StripePaymentIntent>;

  /** Throws `VALIDATION_FAILED` when the signature does not verify. */
  abstract constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): StripeWebhookEvent;
}
