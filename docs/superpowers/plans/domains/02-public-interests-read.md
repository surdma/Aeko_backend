# Public Interests Read NestJS Migration Plan

## Scope

Migrate the candidate implementation for `GET /api/interests` only. Express remains the production
owner until parity and route cutover are reviewed.

## Agent routing

- Orchestrator: selects the low-risk read slice and enforces one owner.
- Planner: owns this scope, deferred capabilities and cutover criteria.
- Legacy Express engineer: captures `server.js`, `routes/interestRoutes.js` and Prisma behavior.
- NestJS backend engineer: implements `src/interests/**` and shared rate-limit infrastructure.
- Reviewer: validates contract, persistence, rate limiting, error safety and rollback.
- Blockchain integration engineer: not required; this route has no AEKO state or asset effects.

## Legacy contract

- Method and path: `GET /api/interests`.
- Mount middleware: general API rate limit, 100 requests per 15 minutes.
- No authentication or authorization.
- Prisma query: `interest.findMany({ where: { isActive: true } })`.
- No explicit database ordering; the candidate must not invent one.
- Success: `200` with `{ success: true, data: interests }`.
- Unexpected query failure: `500` with
  `{ success: false, message: 'Error fetching interests', error: error.message }`.

## Intentional security correction

The Nest candidate preserves the status and public message but omits the legacy raw `error` field.
The internal error is written through the sanitized structured logger.

## Architecture

- `InterestsController`: transport and exact legacy envelope mapping.
- `InterestsService`: explicit loaded/unexpected result union.
- `InterestsRepository`: read-only typed port.
- `PrismaInterestsRepository`: existing Prisma query without ordering changes.
- `ApiRateLimitModule`: one Nest throttler configuration shared with waitlist.
- `LegacyApiThrottlerExceptionFilter`: existing general API 429 body.

## Deferred capabilities

- `POST /api/interests`: admin authentication and 2FA required.
- `PUT /api/interests/:id`: admin authentication and 2FA required.
- `DELETE /api/interests/:id`: admin authentication and 2FA required.
- `/api/user/interests/**`: JWT identity and user ownership required.
- AdminJS Interest resource: migrate with the complete admin programme.

## Validation

- service success and unexpected-result tests;
- HTTP success and safe-500 tests;
- parity cases against disposable Express and NestJS runtimes;
- Node 24, pnpm, strict typecheck, Biome, Vitest, SWC and Prisma validation;
- no route cutover in this PR.

## Rollback

Keep production routing on Express. No schema, write ownership or durable side effect changes are
included in this candidate slice.
