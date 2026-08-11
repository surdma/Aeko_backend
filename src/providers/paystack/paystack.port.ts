import type { JsonValue } from '../../common/json/json-value';

/**
 * Paystack, reduced to the four things the payment routes actually need.
 *
 * The legacy code spoke to Paystack through an `axios` instance created at
 * module load with the secret key baked into a header. Behind a port the same
 * calls are testable without a network, and a missing key becomes a reported
 * `PROVIDER_UNAVAILABLE` instead of a request signed with `Bearer undefined`.
 */

export interface PaystackInitializeRequest {
  readonly email: string;
  /** Minor units — kobo for NGN — exactly as legacy sent them. */
  readonly amountMinor: number;
  readonly currency?: string | undefined;
  readonly reference: string;
  readonly metadata: JsonValue;
  readonly callbackUrl?: string | undefined;
}

export interface PaystackInitialization {
  readonly authorizationUrl: string;
  readonly accessCode: string;
  readonly reference: string;
}

export interface PaystackTransaction {
  /** Paystack's own status string; `success` is the only settled state. */
  readonly status: string;
  readonly reference: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly metadata: JsonValue;
}

export abstract class PaystackPort {
  abstract initialize(
    request: PaystackInitializeRequest,
  ): Promise<PaystackInitialization>;

  abstract verify(reference: string): Promise<PaystackTransaction>;

  /**
   * Constant-time comparison of the `x-paystack-signature` header against an
   * HMAC-SHA512 of the raw request body. The raw bytes matter: re-serialising
   * the parsed JSON produces a different digest.
   */
  abstract verifySignature(rawBody: Buffer, signature: string): boolean;
}
