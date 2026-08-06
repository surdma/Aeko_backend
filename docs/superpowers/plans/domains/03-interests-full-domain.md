# Complete Interests Domain Migration

## Scope

Migrate the complete legacy interests capability as one bounded domain:

- public active-interest listing;
- administrator create, update and delete;
- authenticated user interest listing, merge and removal;
- JWT identity compatibility;
- administrator authorization;
- operation-level TOTP enforcement and security-event audit writes.

Express remains the production owner until black-box parity and route cutover are approved.

## Architecture

```text
src/modules/interests/
  interests.module.ts
  interests.controller.ts
  user-interests.controller.ts
  interests.service.ts
  interests.repository.ts
  interest.schemas.ts

src/modules/auth/
  auth.module.ts
  auth.service.ts
  auth.repository.ts
  auth.types.ts
  guards/

src/infrastructure/prisma/repositories/
  prisma-interests.repository.ts
  prisma-auth.repository.ts

src/infrastructure/auth/
  totp-verification.service.ts
```

The direction is controller -> domain service -> typed port -> Prisma/auth infrastructure.
Controllers do not query Prisma or read environment variables.

## Legacy behavior preserved

- JWTs accept either `id` or `userId` claims.
- Missing, invalid, expired, unknown-user and banned-user responses retain their legacy status and envelope.
- Administrator writes require both administrator privilege and TOTP when enabled.
- Interest names are lowercased on create; display names and optional fields retain their values.
- User interest updates validate active IDs, merge without duplicates and mark `profileCompletion.interestsSelected`.
- General API throttling remains 100 requests per 15 minutes.

## Approved corrections

- Raw internal errors are never returned to clients.
- Invalid request bodies receive stable 400 errors instead of accidental 500 responses.
- Missing-interest deletion returns the documented 404 response.
- AES-256-GCM decryption uses `createDecipheriv`; the legacy non-existent `createDecipherGCM` call is not reproduced.
- `.env.example` contains placeholders only; previously committed credentials must be considered compromised and rotated.

## Validation

- configuration tests;
- health and waitlist regression tests after architecture relocation;
- auth service tests for claim formats, suspension and token expiry;
- interest service tests for normalization, field-selection, ID validation and profile completion;
- HTTP tests for public, authenticated, administrator and safe-error responses;
- dual-runtime parity cases for all seven routes;
- `pnpm quality` after the single feature commit.

## Cutover and rollback

No cutover is included. Keep all seven Express routes authoritative. After disposable-data parity passes,
route the complete domain to NestJS in one reviewed deployment change. Roll back by restoring routing
to the unchanged Express service; do not run both write owners concurrently.
