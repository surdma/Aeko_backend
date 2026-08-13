# Payments and subscriptions migration

Domain 5 of the Express → NestJS migration. Thirty capabilities: three models,
seven provider integrations (Paystack, Stripe, email) and nineteen routes
spanning coins, one-off payments, subscriptions, subscription plans and
provider webhooks. Risk is **critical**: every defect here is a money defect.

Depends on `auth-users-security` (session, admin and two-factor guards), which
is already migrated.

## Route surface to preserve

| Route                                    | Auth          | Legacy source                          |
| ---------------------------------------- | ------------- | -------------------------------------- |
| `GET /api/coins/packages`                | public        | `routes/coinRoutes.js:21`              |
| `GET /api/coins/balance`                 | session       | `routes/coinRoutes.js:26`              |
| `GET /api/coins/history`                 | session       | `routes/coinRoutes.js:39`              |
| `POST /api/coins/purchase`               | session       | `routes/coinRoutes.js:67`              |
| `GET /api/coins/purchase/verify`         | public        | `routes/coinRoutes.js:136`             |
| `POST /api/coins/purchase/verify-stripe` | session       | `routes/coinRoutes.js:193`             |
| `POST /api/payments/pay`                 | session + 2FA | `routes/paymentRoutes.js:80`           |
| `GET /api/payments/verify`               | session       | `routes/paymentRoutes.js:81`           |
| `POST /api/subscription/initialize`      | session + 2FA | `routes/subscriptionRoutes.js:171`     |
| `GET /api/subscription/verify`           | public        | `routes/subscriptionRoutes.js:211`     |
| `GET /api/subscription/status`           | session       | `routes/subscriptionRoutes.js:243`     |
| `GET /api/subscription/admin/all`        | admin         | `routes/subscriptionRoutes.js:36`      |
| `GET /api/subscription/admin/stats`      | admin         | `routes/subscriptionRoutes.js:100`     |
| `GET /api/subscription-plans`            | public        | `routes/subscriptionPlanRoutes.js:93`  |
| `POST /api/subscription-plans`           | admin         | `routes/subscriptionPlanRoutes.js:60`  |
| `PUT /api/subscription-plans/:id`        | admin         | `routes/subscriptionPlanRoutes.js:128` |
| `DELETE /api/subscription-plans/:id`     | admin         | `routes/subscriptionPlanRoutes.js:162` |
| `POST /api/webhooks/paystack`            | signature     | `routes/webhookRoutes.js:45`           |
| `POST /api/webhooks/stripe`              | signature     | `routes/webhookRoutes.js:93`           |

The two verify routes stay public: provider callback URLs hit them without a
session, so requiring one would break the payment flow.

## Legacy defects found while reading the source

| #   | Where                                    | Defect                                                                                                                                                                                                            | Disposition                                                                                              |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `coinRoutes.js:159`                      | Coin credit reads `user.coinBalance`, adds, then writes the computed total. Concurrent credits silently overwrite one another.                                                                                    | correct — atomic `increment` inside the transaction                                                      |
| 2   | `coinRoutes.js:148`                      | Idempotency is `findFirst` then `create` with no transaction, so two concurrent verifies both pass the check and credit twice.                                                                                    | correct — re-check and insert inside one `Serializable` transaction                                      |
| 3   | `coinRoutes.js:141`                      | The Paystack verify accepts the provider's `status` but never checks the amount or currency paid against the package price.                                                                                       | correct — reject a mismatch                                                                              |
| 4   | `subscriptionPaymentService.js:150`      | `handleSubscriptionPaymentSuccess` reads `status === 'completed'` outside the transaction that writes it, so a webhook and a verify racing each other both extend the subscription.                               | correct — conditional `updateMany` on `status: 'pending'` inside the transaction is the idempotency gate |
| 5   | `subscriptionPaymentService.js`          | Stripe init never stores the PaymentIntent id on the transaction, and verify then calls `paymentIntents.retrieve(reference)` with the `SUB-…` reference. Stripe subscription verification fails 100% of the time. | correct — persist the provider reference at init and verify with it                                      |
| 6   | `webhookRoutes.js:57`                    | The Paystack signature is compared with `!==`, which is not constant-time, and the header is used without checking it is a string.                                                                                | correct — `timingSafeEqual` on equal-length buffers                                                      |
| 7   | `webhookRoutes.js:108`                   | `paymentIntent.metadata.transactionId` is read without a null check; a provider event without metadata throws and returns 500, which makes the provider retry a request that can never succeed.                   | correct — treat missing metadata as "nothing to do", acknowledge                                         |
| 8   | `paymentService.js:47`                   | Flutterwave verify compares `response.status === 'successful'`, but the API returns `status: 'success'` with the transaction state under `data.status`. The route can never report success.                       | correct — read `data.status`                                                                             |
| 9   | `coinRoutes.js`, `subscriptionRoutes.js` | Several 500 responses include `error.message`, leaking provider and database internals to clients.                                                                                                                | correct — the existing `DomainError` filter already withholds internals                                  |

Deliberately **not** changed:

- `updateUserSubscriptionWithTx` sets the new expiry a month/year from _now_
  rather than extending the remaining term. Renewing early loses the remainder.
  Changing it would alter billing outcomes, so it is preserved and documented.
- `pkg.pricePaise * 100` charged as NGN kobo. The field name says paise, the
  charge says naira. Prices are a business decision, not a migration one:
  preserved exactly.
- `POST /api/payments/pay` ignores the authenticated user and takes `email`,
  `name` and `phone` from the body, writes no `Transaction` row, and redirects
  to the placeholder `https://your-site.com/payment-success`. All preserved;
  documented loudly as unreconciled.
- `GET /api/subscription/admin/all` defaults to `subscriptionStatus != 'inactive'`
  when no status filter is given. Preserved.

## Provider strategy

The Nest app depends on neither `axios` nor a Paystack SDK, and adding
`flutterwave-node-v3` for one broken route is not worth it. Providers therefore
sit behind ports, as `ContentChainPort` and `DebateScoringPort` already do:

- `PaystackPort` — `initialize`, `verify`, `verifySignature`. HTTP adapter over
  `fetch`.
- `StripePort` — `createCheckoutSession`, `retrieveSession`,
  `createPaymentIntent`, `retrievePaymentIntent`, `constructWebhookEvent`.
  Adapter over the official `stripe` package, which is required for correct
  webhook signature verification.
- `FlutterwavePort` — `initiate`, `verify`. HTTP adapter over `fetch` against
  the same v3 endpoints the SDK wraps, returning the API payload unchanged.

Each port gets an unavailable adapter that raises `PROVIDER_UNAVAILABLE` when
its keys are absent, which reproduces the legacy "not configured" behaviour
without inventing a result.

## Tasks

1. Generate the modules with the Nest CLI and record them in the ledger; add
   the `stripe` dependency; write the owners map for the thirty capabilities.
2. Contracts: coin purchase/verify, payment initiate/verify, subscription
   initialize/verify, plan create/update, and the two admin list queries.
3. Provider ports and adapters, including the webhook signature verifiers.
4. Coins slice — packages, balance, history, purchase, both verifies. This is
   where defects 1, 2 and 3 are closed.
5. Subscriptions slice — initialize, verify, status, admin all/stats, and the
   shared `handleSubscriptionPaymentSuccess`. Closes defects 4 and 5.
6. Subscription plans slice and the Flutterwave payments slice. Closes 8.
7. Webhooks slice — raw-body handling, signature verification, dispatch.
   Closes 6 and 7.
8. Cutover — route-set assertion with no additions, 30/30 closure, corrections
   registered, and the compatibility document.

Each task follows the same rule as the previous four domains: write the failing
test first, implement, then run the domain suite, `tsc` and ESLint before
moving on.
