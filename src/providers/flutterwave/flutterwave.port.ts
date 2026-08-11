import type { JsonValue } from '../../common/json/json-value';

/**
 * Flutterwave, used by `POST /api/payments/pay` and `GET /api/payments/verify`.
 *
 * Legacy used `flutterwave-node-v3`, a thin wrapper over two v3 REST calls, and
 * returned the wrapper's response to the client verbatim. The port keeps that
 * contract: `initiate` and `verify` hand back the provider payload unchanged so
 * the response body a client sees does not move, and the adapter calls the same
 * two endpoints the SDK wraps.
 */

export interface FlutterwaveInitiateRequest {
  readonly txRef: string;
  readonly amount: number;
  readonly currency: string;
  readonly redirectUrl: string;
  readonly paymentOptions: string;
  readonly customer: Readonly<{
    email: string;
    phonenumber: string | null;
    name: string | null;
  }>;
}

export interface FlutterwaveVerification {
  /**
   * The transaction state, read from `data.status`. Legacy read the envelope's
   * `status` instead, which is `success` for any answered call, so the route
   * could never report a successful payment.
   */
  readonly transactionStatus: string | null;
  readonly raw: JsonValue;
}

export abstract class FlutterwavePort {
  abstract initiate(request: FlutterwaveInitiateRequest): Promise<JsonValue>;

  abstract verify(transactionId: string): Promise<FlutterwaveVerification>;
}
