# Better Auth v1 and Notification SSE Design

## Goal

Replace Aeko's custom authentication authority with Better Auth while preserving the already migrated NestJS authentication contract as an explicitly versioned `v0` compatibility surface.

The canonical authentication surface will be Better Auth at `/api/auth/**`. The legacy-compatible surface will move to `/api/v0/auth/**`. New identity, session, account, verification, passkey and two-factor persistence will follow Better Auth's generated schema and documented behavior rather than copying custom legacy behavior.

Notifications will retain their request/response API and add an authenticated Server-Sent Events stream for realtime delivery.

## Source authority

Implementation follows the stable Better Auth 1.6 documentation and current stable package line, not the 1.7 beta/RC documentation:

- installation and handler mounting: https://better-auth.com/docs/installation
- Express/Node handler bridge: https://better-auth.com/docs/integrations/express
- Prisma adapter and generated schema: https://better-auth.com/docs/adapters/prisma
- database schema, hooks and model customization: https://better-auth.com/docs/concepts/database
- email/password and password migration: https://better-auth.com/docs/authentication/email-password
- email verification and password reset: https://better-auth.com/docs/concepts/email
- Google OAuth and account linking: https://better-auth.com/docs/concepts/oauth and https://better-auth.com/docs/concepts/users-accounts
- mobile/Expo: https://better-auth.com/docs/integrations/expo
- bearer sessions for non-cookie clients: https://better-auth.com/docs/plugins/bearer
- username: https://better-auth.com/docs/plugins/username
- passkeys: https://better-auth.com/docs/plugins/passkey
- two-factor authentication: https://better-auth.com/docs/plugins/2fa
- Resend Node SDK and idempotency: https://resend.com/docs/send-with-nodejs and https://resend.com/docs/api-reference/emails/send-email

## Non-goals

This slice does not:

- delete the legacy Express runtime;
- silently reuse legacy routes as the Better Auth API;
- make `users.password`, JSON OAuth fields or JSON verification fields part of Better Auth's canonical schema;
- claim live Google, passkey hardware or Resend delivery without approved disposable credentials;
- add Redis, Kafka, microservices or a general event bus merely for SSE;
- rename populated production tables without an expand-and-contract migration and rollback path.

## Version and ownership boundary

### Canonical v1

- Base path: `/api/auth/**`.
- Owner: Better Auth's `auth.handler` mounted through its official Node handler bridge before JSON body parsing.
- Authentication methods: email/password, Google social auth, username, passkey, two-factor and bearer sessions for mobile/API clients.
- Session authority: Better Auth `session` records and cookies/bearer tokens.
- Password authority: Better Auth credential `account` rows.
- User authority: Better Auth `user` rows.

### Compatibility v0

- Base path: `/api/v0/auth/**`.
- Owner: the existing NestJS legacy-contract controllers and services.
- Purpose: temporary compatibility for existing clients while they move to Better Auth client calls.
- No new product code may depend on v0 auth DTOs, JWT claims or persistence.
- v0 will be removed only after client adoption, data migration, session expiry and rollback gates pass.

## Persistence model

### Better Auth standard tables

Physical table names remain Better Auth defaults:

- `user`
- `session`
- `account`
- `verification`
- `passkey`
- `twoFactor`

Prisma model names may be prefixed with `Auth` to avoid colliding with the existing legacy Prisma `User` model, but `@@map` keeps Better Auth's physical table names and Better Auth configuration sets matching model names.

### Application profile

Authentication data and product profile data are separated.

`Profile` is a one-to-one application-owned row keyed by Better Auth user ID. It owns mutable product fields such as bio, profile/cover pictures, location, verification badges and profile-completion state. Better Auth `user` owns identity fields only: name, email, verification state, image, username and plugin-owned security fields.

Profile creation is idempotent. A Better Auth database hook provisions it after a user is created, and a reconciliation command can repair missing profiles. Profile provisioning must never trust user input for server-owned role, badge or administrative fields.

### Legacy schema

The existing `users` table remains unchanged during the first expand phase. A later reviewed migration will:

1. copy every legacy user into Better Auth `user` with the same ID;
2. create a credential `account` row with `providerId = "credential"` and the existing bcrypt hash;
3. create Google account rows when legacy OAuth evidence is valid;
4. create `Profile` rows from legacy profile columns;
5. create an `AuthMigrationLink` row recording source, target, status and audit timestamps;
6. verify row counts, unique emails/usernames, orphaned foreign keys and sign-in samples;
7. only then rename the legacy table to `v0_users` and repoint remaining legacy-only code.

The cutover migration invalidates legacy JWT sessions. Better Auth sessions are not synthesized from JWTs.

### Password compatibility

The legacy schema stores bcrypt hashes. Better Auth's migration guides explicitly support configuring custom bcrypt hashing/verification when importing existing users. The canonical Better Auth instance therefore uses bcrypt during the compatibility window so migrated users can keep their passwords. A later password-hash upgrade can use a versioned hash strategy and rehash-on-authentication; it is not mixed into this slice.

## Better Auth configuration

The stable configuration includes:

- Prisma adapter with PostgreSQL;
- `basePath: "/api/auth"`;
- explicit `baseURL`, secret rotation support and trusted origins from validated configuration;
- email/password enabled;
- required email verification;
- generic duplicate-signup responses to reduce email enumeration;
- session revocation after password reset;
- Google provider only when both client ID and secret are present;
- explicit account linking (`disableImplicitLinking: true`) to avoid silent same-email account takeover;
- username plugin;
- passkey plugin with validated RP ID and origin;
- two-factor plugin, including email OTP delivery through the same email port;
- bearer plugin for clients that cannot rely on browser cookies;
- Expo server plugin for native cookie/deep-link interoperability;
- telemetry disabled unless explicitly approved.

## NestJS integration

Better Auth requires access to the unparsed request body. The handler is mounted directly on the underlying Express 4 instance before Nest JSON/urlencoded parsers:

1. create Nest with `bodyParser: false`;
2. resolve the Better Auth provider;
3. mount `app.all('/api/auth/*', toNodeHandler(auth))`;
4. mount JSON and urlencoded parsers for all other routes;
5. initialize and listen.

The project will not add the community NestJS integration package in the first slice. The official Better Auth Node handler is sufficient and avoids a second global auth guard or hidden route policy.

Nest application routes authenticate canonical sessions through a focused guard that calls `auth.api.getSession` using `fromNodeHeaders`. It accepts secure cookies and the Better Auth bearer plugin. Authorization remains domain-owned.

## Email and Resend

A provider-neutral `AuthEmailSender` port owns verification, password reset, email-change, welcome/security and 2FA OTP messages. `ResendAuthEmailSender` is the production adapter.

Rules:

- no API key or recipient PII is logged;
- sender domain and address are validated at startup;
- provider failures are caught and reported through the sanitized logger;
- duplicate-sensitive sends use a deterministic Resend idempotency key;
- Better Auth callbacks dispatch without making response time reveal account existence;
- tests use an in-memory sender; CI does not call the public Resend API;
- a provider-contract test exercises request construction and error translation.

## Notification SSE

### Endpoint

`GET /api/notifications/stream`

Authentication uses the canonical Better Auth session guard. During the compatibility window, a separate `/api/v0/notifications/stream` is not added; old clients continue polling.

### Events

The stream emits named events:

- `connected`
- `notification.created`
- `notification.read`
- `notification.read-all`
- `notification.deleted`
- `settings.updated`
- `unread-count.changed`
- `resync`
- `heartbeat`

Every event includes an opaque monotonically increasing process-local ID, timestamp and user-scoped payload. No event may expose another user's notification.

### Delivery model

A focused in-process `NotificationStream` service owns user-scoped subjects and connection cleanup. Existing notification mutations publish after successful persistence. Other modules publish new notifications through a small exported notification publisher rather than importing the stream directly.

This first implementation is single-instance. On reconnect or when `Last-Event-ID` cannot be replayed, the server emits `resync`; the client then calls the existing list and unread-count endpoints. Horizontal fan-out requires Redis/PostgreSQL LISTEN-NOTIFY and is a later deployment decision, not speculative infrastructure in this slice.

### Operational behavior

- `Content-Type: text/event-stream`;
- proxy buffering disabled with `X-Accel-Buffering: no`;
- no response compression;
- heartbeat within common proxy idle limits;
- connection disposed on client disconnect;
- per-user and global connection limits;
- readiness does not depend on active SSE clients.

## Migration phases

### Phase A — boundary and foundation

- move legacy Nest auth route paths to `/api/v0/auth/**`;
- introduce Better Auth configuration/provider/handler;
- add generated standard schema and profile/migration-link models;
- add canonical session guard/decorator;
- add Resend email port and adapter;
- add SSE stream and publish existing notification mutations;
- update runtime verification.

### Phase B — legacy data import

- implement dry-run and apply modes;
- keyset paginate legacy users;
- preserve IDs and bcrypt hashes;
- import profile and valid Google account data;
- record per-user status and failures;
- reconcile counts and orphaned relations;
- run sign-in and account-link samples.

### Phase C — application identity cutover

- migrate domain guards from JWT v0 to Better Auth session guard;
- update domain repositories to canonical user/profile relations;
- expire v0 sessions and stop v0 writes;
- rename legacy tables to `v0_*` only after data and foreign-key verification;
- retain rollback snapshot and migration links.

### Phase D — removal

- remove v0 controllers, JWT/TOTP compatibility code and legacy auth email provider;
- remove unused legacy columns/tables after the stabilization period;
- remove migration bridge only when no rollback or audit requirement depends on it.

## Verification gates

The branch cannot be marked ready until CI:

- installs from a frozen lockfile;
- validates the generated Better Auth Prisma schema;
- builds the compiled Nest server;
- audits source and emitted imports;
- starts PostgreSQL and `node dist/main.js`;
- verifies `/api/v0/auth/**` compatibility paths remain mounted;
- verifies Better Auth email signup, verification, session, sign-out, password reset and username sign-in;
- verifies Google unconfigured behavior without claiming live OAuth;
- verifies bearer session access;
- verifies passkey option endpoints with a SimpleWebAuthn-compatible virtual authenticator or approved test utility;
- verifies profile provisioning;
- verifies Resend adapter construction through a fake transport;
- opens SSE, performs notification mutations, receives user-scoped events and confirms cleanup;
- proves another user cannot receive or mutate those notifications.

## Cutover and rollback

The initial PR does not cut production traffic. It adds the new canonical API and moves the Nest compatibility API to `v0` on the migration branch.

Production cutover requires:

- client inventory and adoption status;
- migrated-user dry-run report;
- disposable staging database rehearsal;
- OAuth callback and mobile deep-link verification;
- Resend verified-domain delivery test;
- passkey tests on supported web and mobile devices;
- route-owner switch and rollback commands;
- monitoring for auth errors, session creation, email failures and SSE connection counts.
