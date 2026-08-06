# Waitlist Signup NestJS Migration Plan

## Roles

- Orchestrator: enforces one owner and the shortest complete migration workflow.
- Planner: owns this bounded scope and acceptance criteria.
- Legacy Express engineer: owns the behavior handoff from `server.js`,
  `routes/waitlistRoutes.js`, `admin.js` and `prisma/schema.prisma`.
- NestJS backend engineer: owns the candidate `src/waitlist/**` slice.
- Reviewer: owns parity, security, rollback and release verdict.
- Blockchain integration engineer: not required; this slice has no AEKO state or asset effect.

## Legacy contract

### Public signup

- Method and path: `POST /api/waitlist`.
- Mount middleware: general API rate limit, 100 requests per 15 minutes.
- No authentication or authorization.
- `name`: string-only, trimmed, must be non-empty.
- `email`: string-only, trimmed, lowercased, must match the existing email expression.
- Missing/non-string/empty fields: `400` with
  `{ "success": false, "message": "Name and email are required" }`.
- Invalid email: `400` with
  `{ "success": false, "message": "A valid email address is required" }`.
- Existing normalized email or Prisma `P2002`: `409` with
  `{ "success": false, "message": "This email is already on the waitlist" }`.
- Success: `201` with `success`, the existing message and the complete Prisma row.
- Database reachability failure: `503` with the existing public message.
- Unexpected failure: `500` with the existing public message.

### Intentional security correction

The Express handler returns `error.message` on unexpected failures. The Nest candidate preserves
status and user-facing message but omits that raw field. This is an approved non-parity path because
database URLs, credentials and internal details must not be disclosed.

### Deferred admin capability

The AdminJS `WaitlistEntry` resource, delete/bulk-delete actions, CSV action and authenticated
`/admin/waitlist-export` route remain Express-owned. They are migrated with the admin programme, not
silently absorbed into the public waitlist module.

## Candidate architecture

- `WaitlistController`: exact HTTP contract and result-to-status translation.
- `JoinWaitlistPipe`: Zod-backed untyped request normalization and validation.
- `WaitlistService`: orchestration and explicit result union.
- `WaitlistRepository`: typed persistence port.
- `PrismaWaitlistRepository`: Prisma implementation using the existing schema.
- Nest throttler guard: route-local legacy rate limit.
- Waitlist throttler filter: exact legacy 429 body.
- Existing global exception filter: preserves explicit legacy envelopes while keeping new platform
  errors structured and request-correlated.

## Tests

- pipe tests for type handling, trimming, lowercasing and validation messages;
- service tests for create, duplicate, database unavailable and unexpected failures;
- HTTP tests for 201, 400, 409, 503 and safe 500 behavior;
- parity case definitions for success, validation, duplicate and intentional raw-error removal;
- full project quality gate under Node 24 and pnpm.

## Cutover

This plan does not cut production traffic. After parity is run against disposable data:

1. record the exact gateway route change;
2. stop Express ownership for `/api/waitlist`;
3. route the path to NestJS;
4. verify status, row effects, logs and rate limiting;
5. retain the Express deployment as rollback;
6. revert routing immediately if error rate, duplicate behavior or row effects differ.

## Completion state

Candidate implementation may be reviewed as complete while `cutoverState` remains `express-owner`.
The slice is not production-migrated until routing evidence and reviewer Pass are recorded.
