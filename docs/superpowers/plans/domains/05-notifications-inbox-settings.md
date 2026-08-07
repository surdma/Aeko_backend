# Domain 05: Notification Inbox and Settings

## Goal

Migrate the complete mounted `routes/notificationRoutes.js` family to a native NestJS candidate without changing deployment ownership or the successful HTTP/database result.

This slice covers notification settings, push-token registration, inbox reads, unread counts, read transitions and deletion. Notification creation performed by reports, posts, comments, follows, livestreams or other legacy producers remains Express-owned until those domains migrate.

## Evidence

- mount: `server.js` -> `app.use("/api/notifications", apiRateLimit, notificationRoutes)`
- legacy route owner: `routes/notificationRoutes.js`
- authentication: `middleware/authMiddleware.js`
- persistence: Prisma `User.notificationSettings`, `User.pushToken` and `Notification`
- providers: none
- Socket.IO: none
- scheduled jobs: none
- payment/blockchain effects: none

## Complete mounted endpoint inventory

| Method | Public path | Middleware | Durable effect |
| --- | --- | --- | --- |
| GET | `/api/notifications/settings` | API limit, JWT | Read `User.notificationSettings` |
| PUT | `/api/notifications/settings` | API limit, JWT | Replace `User.notificationSettings` |
| PUT | `/api/notifications/push-token` | API limit, JWT | Update `User.pushToken` |
| GET | `/api/notifications` | API limit, JWT | Read notifications and count |
| GET | `/api/notifications/unread-count` | API limit, JWT | Count unread notifications |
| PUT | `/api/notifications/:id/read` | API limit, JWT | Set one owned notification `read=true` |
| PUT | `/api/notifications/read-all` | API limit, JWT | Set all owned unread notifications `read=true` |
| DELETE | `/api/notifications/:id` | API limit, JWT | Delete one owned notification |

## Legacy behavior to preserve

### Settings

- `GET /settings` returns the stored JSON directly, with no wrapper.
- Any falsy stored value falls back to:
  - `global.pauseAll=false`
  - `global.quietMode=false`
  - all interaction toggles `true`
  - both network toggles `true`
- `PUT /settings` stores the entire request body and returns the stored JSON directly.
- No partial merge or invented settings schema is applied.

### Push token

- `pushToken` is required by JavaScript truthiness.
- A missing or falsy token returns `400 { "error": "Push token is required" }`.
- Success returns `{ "message": "Push token updated successfully" }`.

### Inbox

- defaults: page `1`, limit `20`;
- JavaScript `parseInt` behavior is preserved;
- optional `type` is an exact Prisma filter;
- order is `createdAt desc`;
- sender projection is exactly `id`, `username`, `name`, `profilePicture`, `blueTick`;
- pagination body is `{ current, pages, total }`.

### Ownership and mutations

- missing notification: `404 { "error": "Notification not found" }`;
- wrong recipient: `403 { "error": "Unauthorized" }`;
- mark-one returns the complete updated Prisma row;
- mark-all ignores the update count and returns the exact success message;
- delete returns the exact success message.

### Errors and throttling

- API limit remains 100 requests per 15 minutes.
- Unexpected errors remain HTTP 500 with `{ "error": "Internal server error" }`.
- Raw database error details remain undisclosed, matching the legacy public response.

## Target architecture

```text
src/modules/notifications/
  notifications.module.ts
  notifications.controller.ts
  notifications.service.ts
  notifications.repository.ts
  notifications.results.ts
  notification-settings.ts
  notification.schemas.ts
  notifications-query.pipe.ts

src/infrastructure/prisma/repositories/
  prisma-notifications.repository.ts
```

Dependency direction:

`controller -> application service -> typed repository port -> Prisma adapter`

## Type-safety rules

- no explicit `any`;
- caught values remain `unknown`;
- readonly record and result types;
- discriminated unions for missing, forbidden and unexpected outcomes;
- JSON conversion stays inside the Prisma adapter;
- optional filters are constructed without assigning `undefined`;
- nullable sender/profile/metadata fields are represented explicitly.

## Tests

1. query defaults and exact `parseInt` behavior;
2. settings default and raw stored JSON behavior;
3. push-token truthiness and type failure;
4. list filter/pagination handoff;
5. owner/not-found mutation decisions;
6. authenticated HTTP responses and raw settings bodies;
7. safe unexpected failures;
8. parity cases for all eight routes.

## Ownership and rollback

- production owner: Express;
- candidate owner: NestJS;
- cutover: not included;
- rollback: keep `/api/notifications/**` routed to the unchanged Express service.

Do not split settings, inbox and mutation routes between runtimes during cutover. Move the complete route family in one reviewed routing change.
