# Integrations and operations

## Payments and webhooks

- Verify provider signatures against the raw request body.
- Enforce replay protection and idempotency.
- Persist provider reference and state transition transactionally.
- Never trust browser-reported payment success.
- Separate provider adapters from billing domain logic.
- Do not mix Paystack, Stripe and Flutterwave conditions throughout controllers.

## Media and IPFS

- Validate ownership, MIME type, size and processing limits.
- Keep provider SDKs behind typed adapters.
- Distinguish mutable media storage from immutable public metadata.
- Clean up failed or abandoned uploads where the provider supports it.

## Realtime

- PostgreSQL is authoritative; Socket.IO is delivery.
- Preserve existing namespaces and payloads during migration.
- Authenticate connection and sensitive events.
- Add room/membership checks before joins, messages, calls or livestream actions.
- Control payload size and backpressure.

## Jobs

Use in-process schedules only for safe, repeatable maintenance. Use a durable queue when work must
survive restarts, retry safely, or process external side effects, including payment reconciliation,
emails, media processing and blockchain confirmation. Do not introduce a queue without such a need.

## Startup and observability

Startup order is configuration validation, database connection, required provider initialization,
then listen. Expose liveness and readiness separately. Use structured logs with request, user,
provider and transaction identifiers while redacting secrets.
