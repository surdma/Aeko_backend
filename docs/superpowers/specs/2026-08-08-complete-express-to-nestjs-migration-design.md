# Complete Express-to-NestJS Migration Design

## Goal

Replace the Aeko ExpressJS runtime in `C:\Users\olaitan\Dev\aeko\backend` with a production-grade NestJS modular monolith in `C:\Users\olaitan\Dev\aeko\aeko_backend` while preserving every supported external contract, database capability, provider integration, realtime protocol, background job, and operational behavior.

The migration should be externally invisible. Existing clients continue to use their current endpoints and payloads. The acceptable visible differences are lower latency, clearer safe errors where the legacy service crashes or leaks internals, and explicitly documented security or correctness repairs.

## Source Of Truth And Scope

The dirty Express repository remains the behavioral reference until the final migration audit passes. Static Swagger documentation is not authoritative when it differs from mounted runtime behavior.

The migration covers:

- all mounted REST routes and their middleware behavior;
- Better Auth replacement of the handwritten authentication implementation;
- all Prisma models, table mappings, relationships, constraints, transactions, and persistence effects;
- Socket.IO root and `/livestream` namespaces, events, acknowledgements, rooms, and signalling;
- scheduled subscription and epoch jobs;
- payment, webhook, email, media, AI, IPFS, Cloudinary, OAuth, and AEKO integrations;
- health, configuration, CORS, cookies, raw bodies, upload limits, rate limits, logging, shutdown, and deployment behavior.

AdminJS UI and other client-side UI are not migrated into NestJS. Their database, authentication, CSV export, route, and operational dependencies are documented so the unchanged UI continues to function against compatible data. Server behavior that is not itself AdminJS UI remains in scope.

Unmounted or inactive legacy files are inventoried but are not promoted into active NestJS features unless executable evidence proves they are required. Existing placeholders and `501` responses remain placeholders unless a documented migration correction says otherwise; migration must not invent missing product behavior.

## Non-Negotiable Engineering Constraints

- Use Node.js 24 LTS, pnpm, NestJS 11, the Nest Express adapter, Prisma 7, PostgreSQL, and Better Auth.
- Use the Nest CLI to generate every new feature module, controller, service, gateway, guard, filter, interceptor, middleware, or resource scaffold. Record the exact CLI command in the migration ledger.
- Organize code by related business capability as complete vertical feature modules, never as a mirror of Express route files or UI pages.
- Enable TypeScript `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and `useUnknownInCatchVariables`.
- Application source must contain no explicit `any`, implicit `any`, unsafe double casts, blanket TypeScript suppressions, or unchecked non-null assertions.
- Treat untyped input and caught errors as `unknown`; narrow them with Zod, generated Prisma types, discriminated unions, or explicit type guards.
- Null safety does not mean rewriting legitimate nullable database semantics. Nullable legacy columns remain compatible, but every use is explicitly narrowed, defaulted, rejected, or represented in a response type so `null` cannot cause a runtime dereference.
- Preserve current public routes, methods, required headers, cookies, status codes, success payloads, pagination, and stable error fields unless a documented correction explicitly supersedes the legacy behavior.
- Do not introduce a second ORM, duplicate database, speculative microservice, unrequested queue, or feature behavior not present in the Express runtime.
- Do not run Express and Nest simultaneously as owners of the same production write route, webhook, socket consumer, or scheduled side effect.

## Target Architecture

The target is one NestJS modular monolith under `src/**`.

### Shared Foundation

The shared foundation contains only capabilities required by multiple completed modules:

- configuration and environment validation;
- Prisma lifecycle and transaction access;
- Better Auth session resolution and authorization primitives;
- request identifiers, structured logging, exception translation, and response compatibility serialization;
- CORS, cookies, raw-body capture, parsing limits, uploads, rate limiting, and trusted-proxy handling;
- provider ports and typed infrastructure adapters;
- health, readiness, graceful shutdown, and observability.

Cross-feature imports are explicit through exported services or injection tokens. Feature modules do not import another module's controllers, repositories, or internal implementation files.

### Feature Modules

Related endpoints are grouped into these bounded capabilities:

1. `auth`, `users`, `profiles`, and `security`;
2. `posts`, `comments`, `status`, `explore`, `notifications`, and `reports`;
3. `debates`, `challenges`, and `spaces`;
4. `interests`, `communities`, `community-profiles`, and community payments;
5. `chat`, enhanced chat, bot, enhanced bot, video calls, and root Socket.IO events;
6. `livestream` HTTP and `/livestream` Socket.IO behavior;
7. `ads`, photo editing, video editing, uploads, media, and IPFS;
8. `payments`, subscription plans, subscriptions, webhooks, and coins;
9. `wallets`, NFTs, marketplace, rewards, staking, and post-chain operations;
10. `admin-api`, support, waitlist, exports, jobs, health, and API documentation.

Large capabilities may contain focused submodules, but transport, orchestration, authorization, persistence, and provider adapters stay within their owning feature boundary.

## Prisma And Data Preservation

The complete legacy Prisma schema and migration history are the starting database contract. The four-table Better Auth-only scaffold is not an acceptable replacement for the legacy schema.

The target schema will:

- retain every legacy model, enum, table mapping, column mapping, relation, index, uniqueness rule, default, numeric type, and nullable field required by existing data;
- merge Better Auth requirements additively into the existing user/account/session model rather than creating a disconnected duplicate user store;
- use reviewed Prisma migrations with expand-and-contract sequencing when a schema transition cannot be immediately backward compatible;
- provide data audits and backfills for Better Auth accounts and sessions without deleting, re-registering, or silently invalidating existing users;
- retain exact money and chain values using database decimals, bigint, or strings as appropriate, never unsafe JavaScript number conversion;
- verify AdminJS and reporting consumers still observe compatible data.

No destructive migration or production backfill runs without separate environment authority, a dry run, row-count evidence, and rollback instructions.

## Better Auth Compatibility Design

Better Auth becomes the authentication and session source of truth, using its Prisma adapter and NestJS integration. Email/password, Google OAuth, bearer sessions, email verification, password reset, and required two-factor behavior are configured from Aeko requirements only.

The existing `/api/auth/**` and overlapping `/api/users/**` contracts remain available through compatibility controllers. These controllers translate legacy request and response shapes into Better Auth operations; clients are not forced to adopt a new endpoint contract during the backend migration.

Existing accounts remain usable. The migration characterizes the legacy password hashing and token behavior, then uses a reviewed compatibility strategy that can verify existing hashes and move users into Better Auth-managed credentials without forcing password resets. Legacy bearer tokens receive an explicit, time-bounded compatibility policy only if current client evidence requires it; new authentication is issued through Better Auth.

Authorization is represented by Nest guards and typed policies for authenticated user, role, ownership, privacy, blocking, administrator, and two-factor requirements. Authentication alone never implies authorization.

The current scaffold's Verilo-specific contracts, email services, username policy, application name, and organization/admin assumptions are removed unless independently supported by Aeko legacy evidence.

## Error And Exception Model

All synchronous and asynchronous failures flow through Nest exception filters or typed domain results. Unknown exceptions are captured by a global filter with a correlation identifier and structured internal event.

Public errors are deterministic, user-friendly, and safe:

- validation errors identify invalid fields without exposing internals;
- authentication and authorization errors remain unambiguous without leaking account existence or policy secrets;
- provider and database outages map to stable retryable responses where the legacy contract permits;
- duplicate, conflict, ownership, privacy, rate-limit, upload, and not-found cases use explicit domain error codes;
- unexpected failures never expose stack traces, SQL, credentials, provider payloads, raw exception messages, or implementation details.

Compatibility serializers preserve legacy envelopes where clients depend on them. Any changed error status or shape is listed in the migration-corrections register with legacy evidence, risk, replacement behavior, and tests.

## Documented Security And Correctness Corrections

Known defects are corrected during migration rather than reproduced when they create secret disclosure, authorization bypass, asset risk, replay risk, data corruption, or deterministic runtime failure. Initial mandatory corrections include:

- incorrect Prisma imports in webhooks and community profiles;
- database readiness being swallowed during startup;
- ineffective blocking/privacy middleware ordering;
- missing Helmet-equivalent security headers where compatible;
- shadowed post routes;
- references to nonexistent Prisma models;
- community-profile documentation/runtime ownership drift;
- incorrect subscription-expiry email invocation;
- known AdminJS fallback cookie secret;
- undocumented versus unimplemented health routes;
- environment loading after chain configuration imports;
- missing wallet ownership proof and signing-address binding;
- missing post ownership checks for anchoring and mint preparation;
- nonexistent explorer history method calls;
- webhook signature, idempotency, and replay weaknesses proven by inspection or tests;
- raw internal error disclosure.

Every correction is implemented, tested in the final hardening phase, and documented with the reason clients will not be surprised. Product placeholders such as unsupported staking writes are not converted into invented features under the label of a correction.

## Migration Execution Strategy

Implementation prioritizes fast translation while retaining a complete audit trail.

### Phase 1: Inventory And Foundation

Create a machine-checkable inventory of every mounted route, middleware chain, Socket.IO event, job, provider effect, Prisma model, and operational capability. Repair the Nest scaffold, restore the complete schema, establish Better Auth, global error handling, configuration, Prisma lifecycle, and strict type gates.

### Phase 2: Fast Feature Translation

Migrate dependency-ordered feature slices. For each feature:

1. record the Nest CLI generation commands;
2. translate Express handlers into controllers, services, guards, DTO schemas, repositories, gateways, and typed adapters;
3. preserve public contracts and persistence effects;
4. apply and record approved corrections;
5. run formatting, strict type checking, Prisma generation/validation, and a production build before proceeding.

The complete exhaustive test suite is intentionally not executed after every endpoint. This keeps implementation throughput high as requested. Compilation, schema validity, and focused smoke checks remain mandatory so one broken slice cannot contaminate all later work.

### Phase 3: Complete-System Battle Testing

After all routes, realtime events, jobs, and integrations have Nest owners, execute the exhaustive test programme against both the legacy Express runtime and the Nest candidate.

Every effective legacy endpoint receives success, validation, authentication, authorization, role, ownership, privacy, blocking, duplicate, empty, missing, malformed, boundary, database-failure, provider-failure, and unexpected-error cases applicable to that endpoint.

Testing also covers:

- exact status, headers, cookies, payloads, pagination, normalization, and database effects;
- concurrent uniqueness, transactions, retries, rollback, idempotency, and replay;
- raw webhook bodies and provider signatures;
- upload types, limits, cleanup, and provider failure;
- Socket.IO authentication, rooms, ordering, acknowledgements, reconnects, and signalling;
- job schedules, locks, duplicate execution, time boundaries, and effects;
- payment values, reconciliation, and failure recovery;
- blockchain construction, ownership, confirmation assumptions, explorer failure, and numeric precision;
- process startup, readiness, shutdown, CORS, proxy, body parsing, rate limits, logging, and secret redaction;
- representative latency and query-count comparison so the Nest service does not regress performance.

Differences are allowed only when they match an entry in the approved corrections register. All other mismatches return to implementation.

### Phase 4: Independent Review And Cutover

An independent reviewer verifies inventory completeness, endpoint parity, security corrections, authorization, schema and data compatibility, error safety, type safety, runtime evidence, provider behavior, performance evidence, deployment ownership, and rollback.

Final cutover requires:

- zero unknown or unclassified inventory items;
- zero explicit or implicit `any` in application source;
- zero unresolved TypeScript, lint, Prisma, build, unit, integration, contract, realtime, job, payment, provider, or blockchain failures;
- no unexpected null dereferences or unhandled promise rejections under the battle-test suite;
- every legacy capability mapped to a verified Nest owner or documented inactive item;
- every behavioral difference mapped to an approved correction;
- single production ownership for each route, webhook, event consumer, and job;
- exercised rollback instructions;
- independent reviewer Pass.

Until these gates pass, the repository is reported as a partial migration, regardless of how many files compile.

## Performance And Maintainability

The migration targets equal or better performance, but performance claims require measurement. Baselines and Nest results record representative p50/p95 latency, database query counts, payload size, memory behavior, and high-cost provider paths. Obvious N+1 queries, repeated provider calls, missing indexes, and blocking work are corrected when doing so preserves observable behavior.

Maintainability comes from feature ownership, small typed services, constructor injection, explicit ports, schema-validated boundaries, centralized cross-cutting behavior, and tests that describe public contracts rather than implementation details.

## Documentation Deliverables

The repository will contain:

- the machine-readable capability inventory and route/event/job coverage report;
- the migration-corrections register;
- module ownership and dependency documentation;
- Better Auth account/session/backfill and rollback instructions;
- AdminJS and client-side compatibility notes without migrating UI code;
- environment and provider configuration reference with no secrets;
- cutover, monitoring, and rollback runbooks;
- final Express-versus-Nest parity and performance reports;
- the independent final review verdict.

## Completion Definition

The migration is 10/10 complete only when executable evidence proves that every supported Express capability exists in NestJS, all approved corrections are implemented, existing data and clients remain compatible, strict null-safe type gates pass, the complete battle-test suite passes, performance does not regress materially, operational ownership is singular, rollback is proven, and the independent reviewer returns Pass.

