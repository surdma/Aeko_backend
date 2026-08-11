import { PrismaService } from '../../src/database/prisma/prisma.service';
import { PrismaCommunityPaymentAdapter } from '../../src/providers/community-payment/prisma-community-payment.adapter';

interface TxRow {
  id: string;
  userId: string;
  communityId: string | null;
  amount: number;
  paymentMethod: string;
  status: string;
}

interface CommunityRow {
  id: string;
  members: unknown;
  memberCount: number;
  settings: unknown;
}

interface UserRow {
  id: string;
  communities: unknown;
}

/** Mirrors the Prisma filters the claim actually uses. */
type StatusPredicate = string | Readonly<{ not: string }>;

const statusMatches = (status: string, predicate: StatusPredicate): boolean =>
  typeof predicate === 'string'
    ? status === predicate
    : status !== predicate.not;

const makeTx = (overrides: Partial<TxRow> = {}): TxRow => ({
  id: 'tx-1',
  userId: 'user-1',
  communityId: 'community-1',
  amount: 25,
  paymentMethod: 'paystack',
  status: 'pending',
  ...overrides,
});

const makeCommunity = (
  overrides: Partial<CommunityRow> = {},
): CommunityRow => ({
  id: 'community-1',
  members: [],
  memberCount: 0,
  settings: { payment: { isPaidCommunity: true, price: 25 } },
  ...overrides,
});

interface Harness {
  readonly adapter: PrismaCommunityPaymentAdapter;
  readonly transactions: Map<string, TxRow>;
  readonly communities: Map<string, CommunityRow>;
  readonly users: Map<string, UserRow>;
  readonly transactionOptions: unknown[];
  membershipWrites: number;
}

const createHarness = (
  options: Readonly<{
    transactions?: readonly TxRow[];
    communities?: readonly CommunityRow[];
    users?: readonly UserRow[];
  }> = {},
): Harness => {
  const transactions = new Map(
    (options.transactions ?? [makeTx()]).map((row) => [row.id, row]),
  );
  const communities = new Map(
    (options.communities ?? [makeCommunity()]).map((row) => [row.id, row]),
  );
  const users = new Map(
    (options.users ?? [{ id: 'user-1', communities: [] }]).map((row) => [
      row.id,
      row,
    ]),
  );

  const harness: Harness = {
    adapter: undefined as unknown as PrismaCommunityPaymentAdapter,
    transactions,
    communities,
    users,
    transactionOptions: [],
    membershipWrites: 0,
  };

  let queue: Promise<unknown> = Promise.resolve();

  const db = {
    transaction: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(transactions.get(where.id) ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; status: StatusPredicate };
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => {
        const row = transactions.get(where.id);
        if (row === undefined || !statusMatches(row.status, where.status)) {
          return Promise.resolve({ count: 0 });
        }
        transactions.set(row.id, {
          ...row,
          status: typeof data.status === 'string' ? data.status : row.status,
        });
        return Promise.resolve({ count: 1 });
      },
    },
    community: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(communities.get(where.id) ?? null),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = communities.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing'));
        if (data.members !== undefined) harness.membershipWrites += 1;
        const next: CommunityRow = {
          ...row,
          members: data.members ?? row.members,
          memberCount:
            typeof data.memberCount === 'number'
              ? data.memberCount
              : row.memberCount,
          settings: data.settings ?? row.settings,
        };
        communities.set(next.id, next);
        return Promise.resolve(next);
      },
    },
    user: {
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(users.get(where.id) ?? null),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        const row = users.get(where.id);
        if (row === undefined) return Promise.reject(new Error('missing'));
        const next: UserRow = {
          ...row,
          communities: data.communities ?? row.communities,
        };
        users.set(next.id, next);
        return Promise.resolve(next);
      },
    },
    $transaction: (operation: unknown, opts: unknown): Promise<unknown> => {
      const run = queue.then(() => {
        harness.transactionOptions.push(opts);
        if (typeof operation !== 'function') {
          throw new Error('expected callback');
        }
        return Reflect.apply(operation, undefined, [db]) as unknown;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  return Object.assign(harness, {
    adapter: new PrismaCommunityPaymentAdapter(
      new PrismaService(
        db as unknown as ConstructorParameters<typeof PrismaService>[0],
      ),
    ),
  });
};

const membersOf = (row: CommunityRow | undefined): readonly unknown[] =>
  Array.isArray(row?.members) ? row.members : [];

const earningsOf = (row: CommunityRow | undefined): Record<string, unknown> => {
  const settings = row?.settings;
  if (typeof settings !== 'object' || settings === null) return {};
  const payment: unknown = Reflect.get(settings, 'payment');
  return typeof payment === 'object' && payment !== null
    ? (payment as Record<string, unknown>)
    : {};
};

describe('community payment settlement', () => {
  it('grants membership, syncs the user and credits earnings', async () => {
    const harness = createHarness();
    await harness.adapter.settle('tx-1');

    const community = harness.communities.get('community-1');
    expect(membersOf(community)).toEqual([
      {
        user: 'user-1',
        role: 'member',
        status: 'active',
        subscription: expect.objectContaining({
          type: 'one_time',
          isActive: true,
          paymentMethod: 'paystack',
          transactionId: 'tx-1',
          endDate: null,
        }) as unknown,
      },
    ]);
    expect(community?.memberCount).toBe(1);
    expect(earningsOf(community)).toMatchObject({
      totalEarnings: 25,
      availableForWithdrawal: 25,
      // Settings the community already had must survive the credit.
      isPaidCommunity: true,
      price: 25,
    });
    expect(harness.transactions.get('tx-1')?.status).toBe('completed');
    expect(harness.transactionOptions).toContainEqual({
      isolationLevel: 'Serializable',
    });
  });

  it('records the membership on the user as well', async () => {
    const harness = createHarness();
    await harness.adapter.settle('tx-1');

    const user = harness.users.get('user-1');
    expect(user?.communities).toEqual([
      expect.objectContaining({
        community: 'community-1',
        role: 'member',
        notifications: true,
      }) as unknown,
    ]);
  });

  it('dates a monthly term a month out and a yearly term a year out', async () => {
    for (const [type, months] of [
      ['monthly', 1],
      ['yearly', 12],
    ] as const) {
      const harness = createHarness({
        communities: [
          makeCommunity({ settings: { payment: { subscriptionType: type } } }),
        ],
      });
      await harness.adapter.settle('tx-1');

      const member = membersOf(harness.communities.get('community-1'))[0];
      const subscription: unknown =
        typeof member === 'object' && member !== null
          ? Reflect.get(member, 'subscription')
          : null;
      const endDate: unknown =
        typeof subscription === 'object' && subscription !== null
          ? Reflect.get(subscription, 'endDate')
          : null;

      expect(typeof endDate).toBe('string');
      const expected = new Date();
      expected.setMonth(expected.getMonth() + months);
      expect(
        Math.abs(new Date(String(endDate)).getTime() - expected.getTime()),
      ).toBeLessThan(60_000);
    }
  });

  it('settles exactly once when a webhook is redelivered', async () => {
    const harness = createHarness();
    // Legacy read the status outside the transaction that writes it, so a
    // redelivered event added a second member and credited earnings twice.
    await harness.adapter.settle('tx-1');
    await harness.adapter.settle('tx-1');

    const community = harness.communities.get('community-1');
    expect(membersOf(community)).toHaveLength(1);
    expect(community?.memberCount).toBe(1);
    expect(earningsOf(community)).toMatchObject({ totalEarnings: 25 });
  });

  it('settles exactly once when two deliveries race', async () => {
    const harness = createHarness();
    await Promise.all([
      harness.adapter.settle('tx-1'),
      harness.adapter.settle('tx-1'),
    ]);

    expect(harness.membershipWrites).toBe(1);
    expect(earningsOf(harness.communities.get('community-1'))).toMatchObject({
      totalEarnings: 25,
    });
  });

  it('renews an existing member without inflating the member count', async () => {
    const harness = createHarness({
      communities: [
        makeCommunity({
          members: [
            {
              user: 'user-1',
              role: 'moderator',
              status: 'inactive',
              subscription: { isActive: false },
            },
          ],
          memberCount: 1,
          settings: { payment: { totalEarnings: 100 } },
        }),
      ],
    });

    await harness.adapter.settle('tx-1');

    const community = harness.communities.get('community-1');
    expect(membersOf(community)).toHaveLength(1);
    expect(community?.memberCount).toBe(1);
    // The renewal reactivates without discarding the role they already held.
    expect(membersOf(community)[0]).toMatchObject({
      user: 'user-1',
      role: 'moderator',
      status: 'active',
    });
    expect(earningsOf(community)).toMatchObject({ totalEarnings: 125 });
  });

  it('adds to the stored earnings rather than to a total read earlier', async () => {
    const harness = createHarness({
      transactions: [
        makeTx({ id: 'tx-1' }),
        makeTx({ id: 'tx-2', amount: 40 }),
      ],
      communities: [
        makeCommunity({ settings: { payment: { totalEarnings: 10 } } }),
      ],
      users: [
        { id: 'user-1', communities: [] },
        { id: 'user-2', communities: [] },
      ],
    });

    await harness.adapter.settle('tx-1');
    await harness.adapter.settle('tx-2');

    expect(earningsOf(harness.communities.get('community-1'))).toMatchObject({
      totalEarnings: 75,
      availableForWithdrawal: 65,
    });
  });

  it('reports a missing transaction, community or user', async () => {
    await expect(createHarness().adapter.settle('ghost')).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );

    await expect(
      createHarness({ communities: [] }).adapter.settle('tx-1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      createHarness({ users: [] }).adapter.settle('tx-1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('still settles a payment that arrives after a failed initialisation', async () => {
    // Initialising marks the row `failed` whenever the provider call throws,
    // but the payer may still complete the checkout that was already open.
    // Gating the claim on `pending` would take the money and grant nothing.
    const harness = createHarness({
      transactions: [makeTx({ status: 'failed' })],
    });

    await harness.adapter.settle('tx-1');

    expect(membersOf(harness.communities.get('community-1'))).toHaveLength(1);
    expect(harness.transactions.get('tx-1')?.status).toBe('completed');
    expect(earningsOf(harness.communities.get('community-1'))).toMatchObject({
      totalEarnings: 25,
    });
  });

  it('does nothing for a transaction already marked completed', async () => {
    const harness = createHarness({
      transactions: [makeTx({ status: 'completed' })],
    });

    await harness.adapter.settle('tx-1');

    expect(membersOf(harness.communities.get('community-1'))).toHaveLength(0);
    expect(harness.membershipWrites).toBe(0);
  });

  it('refuses a transaction that is not a community payment', async () => {
    const harness = createHarness({
      transactions: [makeTx({ communityId: null })],
    });
    await expect(harness.adapter.settle('tx-1')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('copes with a community that has no settings or members yet', async () => {
    const harness = createHarness({
      communities: [
        makeCommunity({ members: null, settings: null, memberCount: 0 }),
      ],
    });

    await harness.adapter.settle('tx-1');

    const community = harness.communities.get('community-1');
    expect(membersOf(community)).toHaveLength(1);
    expect(earningsOf(community)).toMatchObject({ totalEarnings: 25 });
  });
});
