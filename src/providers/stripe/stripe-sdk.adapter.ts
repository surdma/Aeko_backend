import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

import { DomainError } from '../../common/errors/domain.error';
import { toJsonValue } from '../../common/json/json-value';
import {
  StripePort,
  type StripeCheckoutRequest,
  type StripeCheckoutSession,
  type StripePaymentIntent,
  type StripePaymentIntentRequest,
  type StripeRetrievedSession,
  type StripeWebhookEvent,
} from './stripe.port';

const EMPTY_METADATA: Readonly<Record<string, string>> = Object.freeze({});

const unavailable = (message: string): DomainError =>
  new DomainError('PROVIDER_UNAVAILABLE', message);

/** Stripe metadata values are always strings; absent keys are dropped. */
const readMetadata = (
  metadata: Stripe.Metadata | null,
): Readonly<Record<string, string>> => {
  if (metadata === null) return EMPTY_METADATA;
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') entries[key] = value;
  }
  return Object.freeze(entries);
};

@Injectable()
export class StripeSdkAdapter extends StripePort {
  private readonly client: Stripe | null;
  private readonly webhookSecret: string;

  constructor(
    secretKey: string = process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: string = process.env.STRIPE_WEBHOOK_SECRET ?? '',
  ) {
    super();
    this.client = secretKey === '' ? null : new Stripe(secretKey);
    this.webhookSecret = webhookSecret;
  }

  async createCheckoutSession(
    request: StripeCheckoutRequest,
  ): Promise<StripeCheckoutSession> {
    const client = this.require();
    const session = await client.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: request.currency,
            product_data: {
              name: request.productName,
              description: request.description,
            },
            unit_amount: request.amountMinor,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      metadata: { ...request.metadata },
    });

    return Object.freeze({ id: session.id, url: session.url });
  }

  async retrieveSession(sessionId: string): Promise<StripeRetrievedSession> {
    const client = this.require();
    const session = await client.checkout.sessions.retrieve(sessionId);
    return Object.freeze({
      id: session.id,
      paymentStatus: session.payment_status,
      amountTotalMinor: session.amount_total,
      currency: session.currency,
      metadata: readMetadata(session.metadata),
    });
  }

  async createPaymentIntent(
    request: StripePaymentIntentRequest,
  ): Promise<StripePaymentIntent> {
    const client = this.require();
    const intent = await client.paymentIntents.create({
      amount: request.amountMinor,
      currency: request.currency,
      description: request.description,
      metadata: { ...request.metadata },
      automatic_payment_methods: { enabled: true },
    });
    return this.toIntent(intent);
  }

  async retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<StripePaymentIntent> {
    const client = this.require();
    const intent = await client.paymentIntents.retrieve(paymentIntentId);
    return this.toIntent(intent);
  }

  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): StripeWebhookEvent {
    const client = this.require();
    if (this.webhookSecret === '') {
      throw unavailable('Stripe webhooks are not configured.');
    }

    let event: Stripe.Event;
    try {
      event = client.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      // The provider's message can carry payload fragments; it is not relayed.
      throw new DomainError(
        'VALIDATION_FAILED',
        'The webhook signature could not be verified.',
      );
    }

    const object: unknown = event.data.object;
    const metadata =
      typeof object === 'object' && object !== null && 'metadata' in object
        ? readMetadata(readStripeMetadata(object.metadata))
        : EMPTY_METADATA;

    return Object.freeze({
      type: event.type,
      metadata,
      raw: toJsonValue(event),
    });
  }

  private toIntent(intent: Stripe.PaymentIntent): StripePaymentIntent {
    return Object.freeze({
      id: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
      amountMinor: intent.amount,
      currency: intent.currency,
      metadata: readMetadata(intent.metadata),
    });
  }

  private require(): Stripe {
    if (this.client === null) {
      throw unavailable('Stripe is not configured.');
    }
    return this.client;
  }
}

/**
 * Not every event object carries metadata, and the ones that do type it loosely
 * across the union. Narrowing here keeps the adapter free of casts.
 */
function readStripeMetadata(value: unknown): Stripe.Metadata | null {
  if (typeof value !== 'object' || value === null) return null;
  const entries: Stripe.Metadata = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') entries[key] = item;
  }
  return entries;
}
