import { Injectable } from '@nestjs/common';

import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import { CommunityPaymentPort } from '../providers/community-payment/community-payment.port';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripePort } from '../providers/stripe/stripe.port';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { createWebhookPrismaClient } from './webhook-prisma.client';
import type { WebhookPrismaClient } from './webhook-prisma.client';

/** The only Paystack event the dispatcher acts on, as in legacy. */
const PAYSTACK_SETTLED = 'charge.success';
const STRIPE_SETTLED = new Set([
  'payment_intent.succeeded',
  'checkout.session.completed',
]);

export interface WebhookOutcome {
  /** True when the event moved a transaction; false when there was nothing to do. */
  readonly handled: boolean;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackPort,
    private readonly stripe: StripePort,
    private readonly subscriptions: SubscriptionsService,
    private readonly communityPayments: CommunityPaymentPort,
  ) {}

  private get transactions(): WebhookPrismaClient {
    return createWebhookPrismaClient(this.prisma.db);
  }

  async handlePaystack(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookOutcome> {
    if (rawBody === undefined || signature === undefined) {
      throw invalidSignature();
    }
    // Constant-time, over the exact bytes received: re-serialising the parsed
    // JSON produces a different digest and would reject every real event.
    if (!this.paystack.verifySignature(rawBody, signature)) {
      throw invalidSignature();
    }

    const event = parseEvent(rawBody);
    if (event === null) throw invalidSignature();
    if (event.name !== PAYSTACK_SETTLED) return notHandled();

    const fromMetadata = readString(event.data, 'metadata', 'transactionId');
    if (fromMetadata !== null) return this.dispatch(fromMetadata);

    // Legacy's fallback: find the transaction by the provider reference.
    const reference = readString(event.data, 'reference');
    if (reference === null) return notHandled();
    const transaction = await this.transactions.findIdByReference(reference);
    return transaction === null ? notHandled() : this.dispatch(transaction);
  }

  async handleStripe(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookOutcome> {
    if (rawBody === undefined || signature === undefined) {
      throw invalidSignature();
    }
    const event = this.stripe.constructWebhookEvent(rawBody, signature);
    if (!STRIPE_SETTLED.has(event.type)) return notHandled();

    // Legacy read `.metadata.transactionId` unguarded, so an event without
    // metadata threw and answered 500 — making Stripe retry forever a request
    // that could never succeed.
    const transactionId = event.metadata.transactionId;
    if (transactionId === undefined || transactionId === '') {
      return notHandled();
    }
    return this.dispatch(transactionId);
  }

  /**
   * Routes a settled transaction to the domain that owns it. Both settlement
   * paths are idempotent, so a redelivered event changes nothing.
   */
  private async dispatch(transactionId: string): Promise<WebhookOutcome> {
    const kind = await this.transactions.findKind(transactionId);
    if (kind === null) return notHandled();

    if (kind.planId !== null) {
      await this.subscriptions.completeTransaction(transactionId);
      return Object.freeze({ handled: true });
    }
    if (kind.communityId !== null) {
      await this.communityPayments.settle(transactionId);
      return Object.freeze({ handled: true });
    }
    // Neither a subscription nor a community payment: nothing owns it.
    return notHandled();
  }
}

const notHandled = (): WebhookOutcome => Object.freeze({ handled: false });

function invalidSignature(): DomainError {
  return new DomainError(
    'VALIDATION_FAILED',
    'The webhook signature could not be verified.',
  );
}

interface ProviderEvent {
  readonly name: string;
  readonly data: unknown;
}

function parseEvent(rawBody: Buffer): ProviderEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const name: unknown = Reflect.get(payload, 'event');
  if (typeof name !== 'string') return null;
  const data: unknown = Reflect.get(payload, 'data');
  return Object.freeze({ name, data });
}

/** Reads a nested string out of untrusted provider JSON. */
function readString(
  source: unknown,
  ...path: readonly string[]
): string | null {
  let cursor: unknown = source;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return null;
    cursor = Reflect.get(cursor, key);
  }
  return typeof cursor === 'string' && cursor !== '' ? cursor : null;
}
