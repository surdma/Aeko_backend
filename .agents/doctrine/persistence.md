# Persistence

Prisma is the application ORM and PostgreSQL is the application database.

## Rules

- Do not add new Sequelize models or a second persistence abstraction.
- Commit reviewed Prisma migrations; `db push` is not production migration history.
- One Prisma client lifecycle per process.
- Await database connectivity before reporting readiness or accepting traffic.
- Use transactions for invariants spanning multiple rows.
- Design unique constraints and idempotency keys before relying on application checks.
- Handle concurrent follows, purchases, subscriptions, claims and listing state transitions.
- Avoid generic repositories that merely rename Prisma CRUD.
- Prefer domain-specific queries when an abstraction improves meaning or testability.

## Numeric safety

- Store money as integer minor units or Prisma `Decimal`, never floating-point currency.
- Keep chain `u64` values as `bigint` or decimal strings across boundaries.
- Do not convert lamports or token quantities to JavaScript `number` before display formatting.

## On-chain operations

Persist a lifecycle for application-relevant chain operations, for example:

`PREPARED -> SUBMITTED -> CONFIRMING -> CONFIRMED`

with terminal `FAILED` or `EXPIRED` states. Store idempotency key, user, wallet, operation type,
transaction signature, confirmed slot and sanitized failure reason.
