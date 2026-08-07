# Native NestJS Authentication Domain Migration

## Goal

Migrate every capability mounted by the legacy `routes/auth.js` router into one native NestJS feature without changing the public paths, status codes, response bodies, JWT claims, cookie policy or persistence effects.

Express remains the production owner until dual-runtime parity passes and routing is changed in a separate reviewed cutover.

## Agent routing

- orchestrator: enforce programme order, one owner and rollback evidence;
- planner: enumerate all mounted routes, response branches and side effects;
- legacy Express engineer: provide executable contract handoff from `server.js`, `routes/auth.js`, Passport, email and 2FA services;
- NestJS backend engineer: implement controllers, focused use-case services, typed ports and infrastructure adapters;
- reviewer: verify strict typing, safe errors, endpoint completeness and parity evidence;
- blockchain integration engineer: not required because authentication does not mutate AEKO state or assets.

## Complete route inventory

- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `POST /api/auth/google/mobile`
- `POST /api/auth/signup`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/login`
- `GET /api/auth/profile-completion`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

All routes retain the general API limit of 100 requests per 15 minutes.

## Target architecture

```text
src/modules/auth/
  google-authentication.controller.ts
  registration.controller.ts
  session-authentication.controller.ts
  authenticated-account.controller.ts
  password-recovery.controller.ts
  authentication.service.ts
  registration.service.ts
  session-authentication.service.ts
  google-authentication.service.ts
  password-recovery.service.ts
  authentication-state.ts
  authentication.schemas.ts
  authentication.types.ts
  authentication.repository.ts
  auth-email-delivery.port.ts
  google-identity-provider.port.ts
  password-hasher.port.ts

src/infrastructure/auth/
  bcrypt-password-hasher.ts
  google-identity-provider.service.ts

src/infrastructure/email/
  zeptomail-auth-email.service.ts

src/infrastructure/prisma/repositories/
  prisma-authentication.repository.ts
```

Dependency direction is controller → focused use-case service → typed port → infrastructure adapter. `AuthenticationService` is a thin controller facade and cookie/redirect policy holder; it contains no persistence or provider logic. No controller queries Prisma, loads environment variables, hashes passwords or creates provider clients.

## Behaviour contract

- credential signup retains required-field, six-character password and duplicate-field responses;
- verification codes remain four digits, expire after ten minutes and allow three failed attempts;
- resend remains limited to once per minute;
- JWT login and verification tokens retain legacy `id`/`userId` claims and expiration periods;
- login preserves email-verification, suspension and optional TOTP/backup-code branches;
- OAuth continues to link by provider ID and then email, and creates unique lowercase usernames;
- current-user and profile-completion projections omit password and security JSON;
- logout clears the same `token` cookie policy;
- forgot-password retains its anti-enumeration response and ten-second operation timeout;
- reset-password retains its error-key response envelopes and bcrypt cost.

## Approved safety corrections

- raw internal errors are removed from HTTP and redirect responses;
- OAuth-created accounts use a random bcrypt hash instead of the raw Google subject;
- mobile account email comes only from the verified Google payload;
- verification codes, JWTs, passwords and provider credentials are never logged;
- malformed bodies receive stable 400 responses instead of accidental Prisma or property-access failures.

## Validation gates

1. strict TypeScript and no explicit `any` in the feature;
2. Biome lint;
3. authentication use-case tests;
4. HTTP contract tests for all route groups;
5. SWC production build and Prisma validation;
6. disposable PostgreSQL side-effect comparison;
7. black-box Express/Nest parity for all twelve routes;
8. reviewer Pass before cutover.

## Cutover and rollback

No cutover is included in this feature. Keep `/api/auth/**` routed only to Express. After parity passes, route the complete family to NestJS in one change. Roll back by restoring routing to the unchanged Express router; never accept authentication writes in both runtimes concurrently.
