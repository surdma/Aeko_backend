import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import { PaystackPort } from '../providers/paystack/paystack.port';
import { StripePort } from '../providers/stripe/stripe.port';
import {
  COIN_PACKAGES,
  getCoinPackageById,
  parseCoinHistoryQuery,
  parseCoinPurchase,
  parsePaystackVerifyQuery,
  parseStripeVerifyRequest,
  type CoinHistoryPage,
  type CoinPackage,
  type CoinTransactionView,
} from './coin.contract';
import {
  createCoinPrismaClient,
  type CoinPrismaClient,
  type CoinTransactionClient,
  type CoinTransactionRecord,
} from './coin-prisma.client';

/** Paystack charges in kobo; the catalogue's minor unit is already hundredths. */
const PAYSTACK_CURRENCY = 'NGN';
const STRIPE_CURRENCY = 'usd';
const CREDIT_TYPE = 'purchase';

export interface CoinPurchaseInitialization {
  readonly success: true;
  readonly data: Readonly<{
    reference: string;
    authorizationUrl?: string;
    accessCode?: string;
    sessionId?: string;
    url?: string | null;
    package: CoinPackage;
  }>;
}

export interface CoinCreditResult {
  readonly success: true;
  readonly message: string;
  readonly data: Readonly<{ coins?: number; coinBalance: number }>;
}

@Injectable()
export class CoinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackPort,
    private readonly stripe: StripePort,
  ) {}

  private get coins(): CoinPrismaClient {
    return createCoinPrismaClient(this.prisma.db);
  }

  packages(): {
    readonly success: true;
    readonly data: readonly CoinPackage[];
  } {
    return Object.freeze({ success: true as const, data: COIN_PACKAGES });
  }

  async balance(principal: AuthenticatedPrincipal): Promise<{
    readonly success: true;
    readonly data: Readonly<{ coinBalance: number }>;
  }> {
    const coinBalance = await this.coins.findBalance(principal.userId);
    // Legacy read `user.coinBalance` off a possibly-null row and answered 500.
    if (coinBalance === null) throw userNotFound();
    return Object.freeze({
      success: true as const,
      data: Object.freeze({ coinBalance }),
    });
  }

  async history(
    principal: AuthenticatedPrincipal,
    query: unknown,
  ): Promise<{ readonly success: true; readonly data: CoinHistoryPage }> {
    const { page, limit, type } = parseCoinHistoryQuery(query);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.coins.findHistory(principal.userId, type, skip, limit),
      this.coins.countHistory(principal.userId, type),
    ]);

    return Object.freeze({
      success: true as const,
      data: Object.freeze({
        transactions: Object.freeze(transactions.map(projectTransaction)),
        total,
        page,
        limit,
      }),
    });
  }

  async purchase(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<CoinPurchaseInitialization> {
    const input = parseCoinPurchase(body);
    const pkg = getCoinPackageById(input.packageId);
    if (pkg === null) {
      throw new DomainError('VALIDATION_FAILED', 'Invalid package');
    }

    const reference = `COINS_${randomUUID()}`;

    if (input.paymentMethod === 'paystack') {
      const email = await this.coins.findEmail(principal.userId);
      if (email === null) throw userNotFound();

      const initialization = await this.paystack.initialize({
        email,
        // Preserved exactly: the catalogue's `pricePaise` charged as kobo.
        amountMinor: pkg.pricePaise * 100,
        currency: PAYSTACK_CURRENCY,
        reference,
        metadata: {
          userId: principal.userId,
          packageId: pkg.id,
          coins: pkg.coins,
          type: 'coin_purchase',
        },
      });

      return Object.freeze({
        success: true as const,
        data: Object.freeze({
          reference,
          authorizationUrl: initialization.authorizationUrl,
          accessCode: initialization.accessCode,
          package: pkg,
        }),
      });
    }

    const session = await this.stripe.createCheckoutSession({
      productName: pkg.label,
      description: `${String(pkg.coins)} Aeko Coins`,
      currency: STRIPE_CURRENCY,
      amountMinor: Math.round(pkg.priceUSD * 100),
      successUrl: `${frontendUrl()}/coins/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendUrl()}/coins/cancel`,
      metadata: {
        userId: principal.userId,
        packageId: pkg.id,
        coins: String(pkg.coins),
        reference,
      },
    });

    return Object.freeze({
      success: true as const,
      data: Object.freeze({
        reference,
        sessionId: session.id,
        url: session.url,
        package: pkg,
      }),
    });
  }

  /**
   * Public, because Paystack redirects the payer here without a session. The
   * request names only a reference: everything credited is read back from the
   * provider, so naming someone else's reference cannot credit the caller.
   */
  async verifyPaystack(query: unknown): Promise<CoinCreditResult> {
    const { reference } = parsePaystackVerifyQuery(query);
    const transaction = await this.paystack.verify(reference);

    if (transaction.status !== 'success') {
      throw new DomainError('VALIDATION_FAILED', 'Payment not successful');
    }

    const metadata = readMetadata(transaction.metadata);
    const pkg = getCoinPackageById(metadata.packageId ?? '');
    if (pkg === null) {
      throw new DomainError('VALIDATION_FAILED', 'Invalid package in metadata');
    }
    if (metadata.userId === null) {
      throw new DomainError('VALIDATION_FAILED', 'Invalid package in metadata');
    }

    // Legacy credited on the provider's status alone, without ever checking
    // that the amount settled matches what the package costs.
    assertAmountMatches(
      transaction.amountMinor,
      pkg.pricePaise * 100,
      transaction.currency,
      PAYSTACK_CURRENCY,
    );

    return this.credit(metadata.userId, pkg, reference, {
      packageId: pkg.id,
      reference,
      paymentMethod: 'paystack',
    });
  }

  async verifyStripe(body: unknown): Promise<CoinCreditResult> {
    const { sessionId } = parseStripeVerifyRequest(body);
    const session = await this.stripe.retrieveSession(sessionId);

    if (session.paymentStatus !== 'paid') {
      throw new DomainError('VALIDATION_FAILED', 'Payment not completed');
    }

    const packageId = session.metadata.packageId ?? '';
    const userId = session.metadata.userId ?? '';
    const reference = session.metadata.reference ?? '';
    const pkg = getCoinPackageById(packageId);
    if (pkg === null || userId === '' || reference === '') {
      throw new DomainError('VALIDATION_FAILED', 'Invalid package');
    }

    if (session.amountTotalMinor !== null) {
      assertAmountMatches(
        session.amountTotalMinor,
        Math.round(pkg.priceUSD * 100),
        session.currency ?? STRIPE_CURRENCY,
        STRIPE_CURRENCY,
      );
    }

    return this.credit(userId, pkg, reference, {
      packageId: pkg.id,
      reference,
      sessionId,
      paymentMethod: 'stripe',
    });
  }

  /**
   * The whole credit — the duplicate check, the balance change and the ledger
   * row — happens in one serializable transaction. Legacy checked for a
   * duplicate outside the transaction and computed the new balance from a value
   * read earlier, so a repeated callback could credit twice and two credits
   * landing together could lose one.
   */
  private async credit(
    userId: string,
    pkg: CoinPackage,
    reference: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<CoinCreditResult> {
    return this.coins.runSerializable(async (transaction) => {
      const already = await transaction.findByReference(reference);
      if (already !== null) {
        return Object.freeze({
          success: true as const,
          message: 'Already processed',
          data: Object.freeze({ coinBalance: already.balanceAfter }),
        });
      }

      const coinBalance = await creditBalance(
        transaction,
        userId,
        pkg,
        metadata,
      );

      return Object.freeze({
        success: true as const,
        message: 'Coins credited successfully',
        data: Object.freeze({ coins: pkg.coins, coinBalance }),
      });
    });
  }
}

const creditBalance = async (
  transaction: CoinTransactionClient,
  userId: string,
  pkg: CoinPackage,
  metadata: Readonly<Record<string, string>>,
): Promise<number> => {
  const coinBalance = await transaction.incrementBalance(userId, pkg.coins);
  await transaction.recordCredit({
    userId,
    type: CREDIT_TYPE,
    amount: pkg.coins,
    balanceAfter: coinBalance,
    description: `Purchased ${pkg.label}`,
    metadata: { ...metadata },
  });
  return coinBalance;
};

function assertAmountMatches(
  settledMinor: number,
  expectedMinor: number,
  settledCurrency: string,
  expectedCurrency: string,
): void {
  const currencyMatches =
    settledCurrency === '' ||
    settledCurrency.toLowerCase() === expectedCurrency.toLowerCase();
  if (settledMinor === expectedMinor && currencyMatches) return;
  throw new DomainError(
    'VALIDATION_FAILED',
    'The amount paid does not match the package price.',
  );
}

interface PaystackMetadata {
  readonly userId: string | null;
  readonly packageId: string | null;
}

/** Provider metadata is untrusted JSON; only the two string keys are read. */
function readMetadata(value: unknown): PaystackMetadata {
  if (typeof value !== 'object' || value === null) {
    return Object.freeze({ userId: null, packageId: null });
  }
  const userId: unknown = Reflect.get(value, 'userId');
  const packageId: unknown = Reflect.get(value, 'packageId');
  return Object.freeze({
    userId: typeof userId === 'string' ? userId : null,
    packageId: typeof packageId === 'string' ? packageId : null,
  });
}

const projectTransaction = (
  record: CoinTransactionRecord,
): CoinTransactionView =>
  Object.freeze({
    id: record.id,
    userId: record.userId,
    type: record.type,
    amount: record.amount,
    balanceAfter: record.balanceAfter,
    description: record.description,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
  });

const frontendUrl = (): string => process.env.FRONTEND_URL ?? '';

function userNotFound(): DomainError {
  return new DomainError('NOT_FOUND', 'User not found.');
}
