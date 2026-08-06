# NestJS operational foundation status

## Scope

This continuation implements Task 4 of the approved clean migration plan. It adds the first
executable NestJS runtime without mounting any legacy Express route, Socket.IO consumer, scheduled
job, webhook, AdminJS action, or provider side effect.

## Ownership

- Product routes, webhooks, sockets, jobs and AdminJS remain `express-owner`.
- `/health/live` and `/health/ready` are new Nest-owned operational endpoints.
- No production cutover is included in this slice.

## Implemented foundation

- NestJS 11 bootstrap under `src/**`.
- SWC compilation with TypeScript retained as the strict type-check gate.
- Node 24 and pnpm toolchain scripts.
- Zod environment validation that fails before listening.
- Request IDs propagated through `x-request-id`.
- Stable public error envelopes with sanitized structured logging.
- Prisma connect/disconnect lifecycle and readiness query.
- Process-only liveness and PostgreSQL-backed readiness.
- Foundation unit and HTTP tests.

## Compatibility and rollback

The default `start` and `dev` scripts now target NestJS. The unchanged Express reference remains
available only through `legacy:start` and `legacy:dev` for parity work. Rollback for this foundation
slice is stopping the candidate Nest deployment; no product write ownership or database schema has
moved.

## Next gate

Run the full Node 24/pnpm quality gate, complete the audited capability inventory and parity harness,
then produce the domain programme before migrating the first product route.
