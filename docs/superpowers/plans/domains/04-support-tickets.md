# Complete Support Tickets Domain Migration

## Scope

Migrate the complete mounted support-ticket route family from `routes/supportRoutes.js` into a native
NestJS feature module. The slice includes ticket creation and listing, ticket details, replies,
status transitions, administrator filtering and administrator priority updates.

Express remains the sole production owner until disposable-data parity and an explicit routing
cutover are independently reviewed.

## Agent sequence

1. Orchestrator selects the NestJS migration workflow and enforces one route owner.
2. Planner records all seven mounted endpoints, dependencies, acceptance criteria and rollback.
3. Legacy Express engineer supplies middleware order, response envelopes, authorization and exact
   Prisma queries from `server.js`, `routes/supportRoutes.js` and `prisma/schema.prisma`.
4. NestJS backend engineer implements the vertical slice.
5. Reviewer verifies contracts, persistence, safe errors, tests and ownership evidence.
6. Blockchain engineer is not required because this domain has no AEKO state or asset movement.

## Legacy contract

| Method | Path | Authorization | Durable effect |
| --- | --- | --- | --- |
| POST | `/api/support/tickets` | JWT | Create `SupportTicket`, default priority `medium` |
| GET | `/api/support/tickets` | JWT | Read caller-owned tickets ordered newest first |
| GET | `/api/support/tickets/:id` | Owner or administrator | Read ticket, owner and messages ordered oldest first |
| POST | `/api/support/tickets/:id/messages` | Owner or administrator | Create `SupportMessage`; update status by sender policy |
| PATCH | `/api/support/tickets/:id/status` | Owner or administrator | Owners may use `closed` or `resolved`; admins retain legacy flexibility |
| GET | `/api/support/admin/tickets` | Administrator | Filter and paginate all tickets |
| PATCH | `/api/support/admin/tickets/:id/priority` | Administrator | Update priority |

All endpoints retain the general API limit of 100 requests per 15 minutes. The legacy support admin
403 body is `{ "error": "Access denied. Admin only." }` and must not be replaced with the interests
admin envelope.

## Target architecture

```text
src/modules/support/
  support.module.ts
  support.controller.ts
  support.service.ts
  support.repository.ts
  support.schemas.ts
  support-validation.pipe.ts
  support-admin-access.guard.ts

src/infrastructure/prisma/repositories/
  prisma-support.repository.ts
```

Dependency direction is controller -> application service -> typed support port -> Prisma adapter.
No controller may query Prisma or read environment variables.

## Type and null safety

- Zod validates every body and administrator pagination boundary.
- Expected not-found, forbidden and user-status failures use discriminated result unions.
- Nullable profile pictures and absent tickets are handled explicitly.
- No explicit `any` is introduced.
- Prisma include shapes remain behind the support repository port.

## Error policy

Preserve legacy success bodies and documented 403/404 responses. Replace raw `error.message`
disclosure with `{ "error": "Server error" }`. Malformed requests receive stable 400 support error
envelopes. Internal exceptions are logged through `SanitizedLogger` only.

## Approved optimization

Create a reply and apply its sender-dependent status transition in one Prisma transaction. The
observable successful response and resulting database state remain identical, while partial writes
are eliminated.

## Tests and parity

- service tests for ownership, reply transitions, status restrictions and unexpected errors;
- HTTP tests for JWT, support-specific admin authorization, pagination and safe errors;
- regression HTTP tests override Prisma lifecycle for database-independent mocks;
- parity cases enumerate all seven endpoints plus the intentional safe-error correction;
- full branch gate: typecheck, Biome lint, all Vitest suites, SWC build and Prisma validation.

## Cutover and rollback

No route cutover is included. Keep `/api/support/**` routed to Express. After parity passes, move the
whole family to NestJS in one reviewed deployment change. Roll back by restoring routing to the
unchanged Express service. Never run both runtimes as production write owners.
