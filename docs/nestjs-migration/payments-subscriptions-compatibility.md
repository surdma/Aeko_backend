# Payments and subscriptions — client compatibility

Domain 5 of the Express → NestJS migration, and the highest-risk one: every
defect here is a money defect. Nineteen routes, thirty capabilities, all closed, with no correction left deferred.
Every legacy path, verb, request field and success response shape is preserved.
The differences below are limited to defects that could not be carried across
verbatim.

## Route surface

| Route                                    | Auth          | Notes                                 |
| ---------------------------------------- | ------------- | ------------------------------------- |
| `GET /api/coins/packages`                | public        | unchanged                             |
| `GET /api/coins/balance`                 | session       | missing user now 404, was 500         |
| `GET /api/coins/history`                 | session       | page size capped                      |
| `POST /api/coins/purchase`               | session       | unchanged                             |
| `GET /api/coins/purchase/verify`         | public        | amount now verified; credit is atomic |
| `POST /api/coins/purchase/verify-stripe` | session       | as above                              |
| `POST /api/payments/pay`                 | session + 2FA | preserved as found                    |
| `GET /api/payments/verify`               | session       | previously could never report success |
| `GET /api/subscription/admin/all`        | admin         | page size capped                      |
| `GET /api/subscription/admin/stats`      | admin         | unchanged                             |
| `POST /api/subscription/initialize`      | session + 2FA | now stores the provider reference     |
| `GET /api/subscription/verify`           | public        | completion is now idempotent          |
| `GET /api/subscription/status`           | session       | previously returned 500 on every call |
| `GET /api/subscription-plans`            | public        | unchanged                             |
| `POST /api/subscription-plans`           | admin         | unchanged                             |
| `PUT /api/subscription-plans/:id`        | admin         | accepts only documented columns       |
| `DELETE /api/subscription-plans/:id`     | admin         | still deactivates, never deletes      |
| `POST /api/webhooks/paystack`            | signature     | constant-time verification            |
| `POST /api/webhooks/stripe`              | signature     | events without metadata acknowledged  |

No routes were added and none were removed. `test/payments-subscriptions/cutover.spec.ts`
pins this set exactly, so a future addition fails the build.

The two verify routes and the two webhooks stay unauthenticated by session on
purpose: providers redirect the payer, or POST server-to-server, with no session
cookie. Requiring one would break payment entirely.

## Money defects corrected

1. **`correction:coin-credit-lost-updates`** — the new balance was computed in
   application code from a value read before the transaction and written back as
   an absolute total, so two credits landing together silently overwrote one
   another. The balance is now incremented inside the transaction.
2. **`correction:coin-credit-double-spend`** — idempotency was a `findFirst`
   followed by a `create` with no transaction between them, so two verifications
   of one reference arriving together both credited. The duplicate check, the
   balance change and the ledger row now happen in a single `Serializable`
   transaction with a bounded `P2034` retry.
3. **`correction:coin-credit-unverified-amount`** — a credit was granted on the
   provider's status alone; what actually settled was never compared with the
   package price. A mismatch in amount or currency is now refused.
4. **`correction:subscription-completion-race`** — the completed check happened
   outside the transaction that writes it, so a webhook racing a verification
   extended the subscription twice. The gate is now a conditional update from
   `pending` to `completed` inside the transaction; the loser is told the work
   was already done.

## Always-failing routes repaired

5. **`correction:stripe-subscription-verify-broken`** — initialization never
   persisted the PaymentIntent id, and verification then asked Stripe to resolve
   the `SUB-…` reference, which is not a Stripe id. Stripe subscription
   verification failed on **every** call. The provider's own reference is now
   recorded at initialization.
6. **`correction:subscription-status-missing-columns`** — the route selected
   `prideTick` and `businessTick`, neither of which is a column on `User` in
   either schema, so Prisma rejected the query and the route answered 500 every
   time. Both are dropped; `goldenTick` is real and is kept.
7. **`correction:flutterwave-verify-status-field`** — the route compared the
   response _envelope's_ `status` to `'successful'`, but the envelope reads
   `'success'` for any answered call and the transaction state lives at
   `data.status`. The route could never report a settled payment. It now reads
   the right field.

## Security corrections

8. **`correction:paystack-webhook-signature-comparison`** — the HMAC was
   compared with a plain inequality, which is not constant-time, on a header
   never checked to be a string. Comparison is now `timingSafeEqual` over
   equal-length buffers of the raw request bytes.
9. **`correction:stripe-webhook-unguarded-metadata`** — the transaction id was
   read off event metadata with no null check, so an event without metadata
   threw and answered 500, making Stripe retry forever a request that could
   never succeed. Such events are now acknowledged as nothing to do.
10. **`correction:subscription-plan-mass-assignment`** — the request body went
    straight into `prisma.update`, so an administrator could rewrite `id` or
    `createdAt`, or drive relation operations. Only documented columns are
    accepted now, each optional so a partial update stays partial.
11. **`correction:payments-unbounded-page-size`** — `limit` was parsed with no
    ceiling. Capped at 100; the legacy defaults of 20 and 10 are unchanged.

## Community settlement: carved out, not deferred

Both providers deliver subscription _and_ community events down the same two
webhook URLs, so the dispatcher had to migrate with this domain even though
community payments belong to `communities` (programme order 6).

Rather than park that behind an unavailable adapter — which would have rested
on a finite provider retry window, roughly three days for Stripe and less for
Paystack — the settlement half of the legacy `communityPaymentService` is
implemented here in full, as `PrismaCommunityPaymentAdapter`. It grants or
renews the membership, keeps `User.communities` in step, bumps `memberCount`
only for a genuinely new member, and credits `settings.payment.totalEarnings`
and `availableForWithdrawal`. Nothing about a community payment now depends on
a later domain arriving in time.

**Scope is strictly settlement.** Initialising a community payment, requesting
a withdrawal and completing one stay with the `communities` domain, which will
consume this adapter rather than duplicate it.

**`correction:community-settlement-race`** covers the defects found there, and
is closed: legacy read the completed status outside the transaction that writes
it and credited earnings by adding to a JSON total read earlier, so a
redelivered webhook granted a second membership, inflated the member count and
credited the earnings twice, while two settlements landing together could lose
one credit. Settlement is now a single `Serializable` transaction gated on a
conditional `pending` → `completed` update, with the membership grant, the user
sync and the earnings credit all inside it.

## Two things the atomic gate had to get right

Making settlement idempotent means settling **exactly once** — not _at most_
once. Two traps sit either side of that, and both are pinned by test.

**`correction:settlement-claim-honours-failed-initialisation`.** The natural
way to write the claim is `WHERE status = 'pending'`. That is wrong here.
Initialising marks a transaction `failed` whenever the provider call throws —
a timeout, a response we could not read — but the payer may still complete a
checkout page that was already open. A `pending`-only gate would find `failed`,
decline to claim, and return quietly: money taken, nothing granted. Legacy
avoided this by short-circuiting only on `completed`, and the gate is
`NOT completed` for the same reason. Both the subscription and community paths
have a test that settles a `failed` transaction and asserts the grant lands.

**`correction:coin-replay-reports-live-balance`.** A replayed coin
verification must report the balance the buyer holds _now_. The ledger row's
`balanceAfter` records what it was when that credit landed, and goes stale the
moment they spend. The replay path reads the live balance inside the same
transaction, as legacy did.

## Preserved deliberately, not corrected

- **Renewal resets the term.** `subscriptionExpiry` is set a month or year from
  _now_, so renewing early forfeits the remainder. Changing it would alter
  billing outcomes — a business decision, not a migration one.
- **Coin pricing.** `pricePaise` is charged to Paystack as kobo. The field name
  says paise, the charge says naira. Prices are preserved exactly.
- **`POST /api/payments/pay` is unreconciled.** It ignores the authenticated
  user, takes `email`, `name` and `phone` from the body, writes no `Transaction`
  row, and redirects to the placeholder `https://your-site.com/payment-success`.
  All of that is preserved. Nothing this route takes is ever reconciled against
  the ledger; it is documented here rather than quietly redesigned.
- **Admin listing default.** With no `status` filter, `GET /api/subscription/admin/all`
  still returns every subscriber whose status is not `inactive`.

## Client-visible deltas to be aware of

- `GET /api/subscription/status`, `GET /api/payments/verify` and Stripe
  subscription verification start returning success where they previously always
  failed. Clients with error-path fallbacks for these can drop them.
- An unconfigured provider now answers `503` where legacy answered `500`. Both
  are 5xx failures, so client failure handling is unchanged.
- Coin and subscription verification can return `409 CONFLICT` under contention;
  the request is safe to retry.
- A coin credit whose settled amount does not match the package price now
  returns `400` instead of silently crediting.
- Administrators sending undocumented fields to `PUT /api/subscription-plans/:id`
  now receive `400` instead of having them written or hitting a 500.
