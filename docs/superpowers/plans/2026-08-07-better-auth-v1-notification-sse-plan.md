# Better Auth v1 and Notification SSE Implementation Plan

## Outcome

Deliver the first expand phase of the Better Auth migration on `migration/better-auth-v1-sse` without deleting legacy behavior or making an untested production cutover.

## Workstream 1 — Freeze and version legacy auth

1. Rename the current Nest auth module class to `AuthV0Module`.
2. Move all current controller route prefixes from `/api/auth` to `/api/v0/auth`.
3. Rename exported legacy guards/types only where needed to prevent accidental use by new code; avoid a broad file move in the same change.
4. Update existing authentication HTTP tests and runtime verification to use v0 paths.
5. Add a route inventory assertion proving no legacy controller owns `/api/auth/**`.

Acceptance:

- all twelve legacy endpoints work under `/api/v0/auth/**`;
- `/api/auth/**` is free for Better Auth;
- legacy response contracts and database effects remain unchanged.

## Workstream 2 — Better Auth dependencies and schema

1. Pin stable Better Auth `1.6.25` packages:
   - `better-auth`;
   - `@better-auth/prisma-adapter`;
   - `@better-auth/passkey`;
   - `@better-auth/expo`.
2. Keep existing bcrypt dependency for migrated password compatibility.
3. Add Better Auth core/plugin models to `prisma/schema.prisma` using Better Auth physical table names.
4. Add `Profile` and `AuthMigrationLink` models.
5. Generate and commit a Prisma migration with expand-only DDL.
6. Add indexes documented by Better Auth where Prisma generation does not create them.

Acceptance:

- `prisma validate` and `prisma generate` pass;
- an empty PostgreSQL database can be created from the schema;
- existing legacy tables remain available.

## Workstream 3 — Configuration and email

1. Add validated environment values:
   - `BETTER_AUTH_SECRET` / rotation list;
   - `BETTER_AUTH_URL`;
   - `BETTER_AUTH_TRUSTED_ORIGINS`;
   - passkey RP ID/name/origin;
   - Resend API key/from address;
   - optional Expo app scheme.
2. Keep v0 JWT/TOTP/ZeptoMail values isolated under `authV0` configuration.
3. Add `AuthEmailSender` and Resend adapter with deterministic idempotency keys.
4. Add an in-memory sender for tests.

Acceptance:

- production config fails fast on missing Better Auth secret/base URL;
- test config uses no real provider secrets;
- email payload and error translation tests pass.

## Workstream 4 — Better Auth infrastructure

1. Create a Better Auth factory using the existing Prisma service.
2. Configure email/password, Google, username, bearer, passkey, two-factor and Expo plugins.
3. Use bcrypt hash/verify during the legacy password compatibility window.
4. Disable implicit Google account linking; preserve explicit linking.
5. Provision `Profile` idempotently after user creation.
6. Mount `toNodeHandler(auth)` on `/api/auth/*` before body parsers.
7. Add canonical session service, guard and current-user decorator for Nest domain routes.

Acceptance:

- `/api/auth/ok` responds from Better Auth;
- email signup creates `user`, credential `account`, `session` as configured and `profile`;
- bearer and cookie sessions resolve to the same user;
- Google is either correctly configured or returns a deterministic configuration failure.

## Workstream 5 — Notification SSE

1. Add a user-scoped stream service with connection accounting and cleanup.
2. Add `GET /api/notifications/stream` protected by Better Auth session guard.
3. Emit connected, mutation, unread-count, heartbeat and resync events.
4. Publish after successful settings, read, read-all and delete mutations.
5. Export a notification publisher for future notification-create integrations.

Acceptance:

- authenticated clients receive only their own events;
- unauthenticated clients receive 401;
- disconnect removes subscriptions;
- reconnection receives a resync instruction;
- existing polling endpoints remain unchanged.

## Workstream 6 — Legacy import command

1. Add `auth:migrate-v0:dry-run` and `auth:migrate-v0:apply` commands.
2. Keyset paginate legacy users.
3. Copy IDs, normalized emails, names, usernames and verification state.
4. Create credential account rows using existing bcrypt hashes.
5. Create Google account rows only from complete, validated legacy provider evidence.
6. Create profiles and migration-link audit rows.
7. Make reruns idempotent and report conflicts instead of overwriting canonical data.

Acceptance:

- dry-run performs no writes;
- apply is restartable;
- duplicate email/username and malformed OAuth records are reported;
- migrated credential sign-in works against a disposable PostgreSQL database.

## Workstream 7 — Runtime verification and review

1. Extend the existing compiled runtime verifier instead of creating a second harness.
2. Exercise v0 routes, Better Auth routes, profile provisioning, bearer sessions and SSE.
3. Use disposable PostgreSQL.
4. Use provider fakes for email and Google; do not call live services in CI.
5. Run strict TypeScript, Biome, Vitest, SWC build and Prisma validation.
6. Reviewer checks route ownership, schema compatibility, account-linking security, cross-user SSE isolation and rollback documentation.

## Commit structure

1. `docs: specify Better Auth v1 and notification SSE migration`
2. `refactor: version legacy authentication as v0`
3. `feat: add Better Auth schema and infrastructure`
4. `feat: deliver notification events over SSE`
5. `feat: add restartable v0 identity migration`
6. `test: verify compiled Better Auth and SSE runtime`

Commits may be squashed before PR review, but CI evidence must correspond to the final PR head.
