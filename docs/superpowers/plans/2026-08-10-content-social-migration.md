# Content and Social Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 52 active `content-social` capabilities — 46 REST routes and 6 Prisma models — into strict NestJS post, comment, status, explore, notification, and report modules without changing successful client behavior, while correcting the shadowed post routes, raw error disclosure, unbounded reads, and missing ownership and blocking checks.

**Architecture:** Six feature modules, each owning one lifecycle-owned Prisma boundary and explicit JSON contracts. `PostsModule` owns post lifecycle, reads, and interactions; `CommentsModule` owns the comment tree; `StatusModule` owns ephemeral status; `ExploreModule` owns the ranked discovery read; `NotificationsModule` owns delivery preferences and the notification inbox; `ReportsModule` owns reporting and administrator moderation. Visibility (privacy, blocking, not-interested) is a shared, explicitly tested policy consumed by every read. On-chain capabilities are reached only through a typed `ContentChainPort` whose adapter arrives with the `chain` domain.

**Tech Stack:** NestJS 11, TypeScript strict mode, Prisma ORM 7, Zod 4, Better Auth principals/guards, Jest.

## Global Constraints

- Treat `docs/nestjs-migration/domains/content-social.json` as the exact 52-capability scope and `C:/Users/olaitan/Dev/aeko/backend` as read-only behavioral evidence.
- Preserve the canonical `Post`, `Comment`, `Status`, `Notification`, `Report`, and `Bookmark` tables and their JSON fields; do not execute migration SQL or connect to a real database.
- Keep native Better Auth as the only authentication implementation and the existing `SessionGuard`, `RoleGuard`, and `TwoFactorGuard` as authorization inputs.
- Keep one lifecycle-owned Prisma client; no feature may instantiate `PrismaClient` or `PrismaPg`.
- Do not use `any`, double casts, non-null assertions, raw request objects, unbounded reads, or raw provider/database errors.
- Generate every new Nest module, controller, service, and port class with the Nest CLI and record the exact command in `docs/nestjs-migration/nest-cli-ledger.md`.
- Correct and document the registered defects: `correction:shadowed-post-routes` and `correction:raw-error-disclosure`, plus any further defect found during migration, registered before it is relied upon.
- Every list endpoint is bounded and every read applies the shared visibility policy.
- AdminJS and all UI remain out of scope. Final whole-backend battle testing and independent review remain programme-final gates after all ten domains.

---

## File Structure

- `src/posts/`: post contracts, controller, service, Prisma boundary, visibility policy.
- `src/comments/`, `src/status/`, `src/explore/`, `src/notifications/`, `src/reports/`: one slice each.
- `src/providers/content-chain/`: typed anchor/mint/verify port with a deferred adapter.
- `test/content-social/`: focused contracts, posts-lifecycle, posts-reads, posts-interactions, comments, status, explore-notifications, reports, and cutover suites.
- `docs/nestjs-migration/domains/content-social-owners.json`: exactly one owner for each of 52 capabilities.

### Task 1: Generate boundaries and lock exact ownership

**Files:**

- Create: `src/posts/{posts.module,posts.controller,posts.service}.ts` and the same trio for `comments`, `status`, `explore`, `notifications`, `reports`
- Create: `src/providers/content-chain/content-chain.port.ts`
- Modify: `src/app.module.ts`, `docs/nestjs-migration/nest-cli-ledger.md`
- Create: `docs/nestjs-migration/domains/content-social-owners.json`
- Test: `test/migration/content-social-coverage.spec.ts`

**Interfaces:** Consumes the committed 52-ID manifest. Produces one owner tuple per capability and six AppModule-imported feature modules.

- [x] **Step 1: Write ownership RED**

```ts
expect(manifest.capabilityIds).toHaveLength(52);
expect(new Set(Object.keys(owners))).toEqual(new Set(manifest.capabilityIds));
expect(Object.values(owners).every((value) => value.length === 1)).toBe(true);
expect(ownerCounts).toEqual({
  posts: 25,
  comments: 6,
  status: 6,
  explore: 1,
  notifications: 9,
  reports: 5,
});
```

- [x] **Step 2: Run RED**

Run: `node node_modules/jest/bin/jest.js test/migration/content-social-coverage.spec.ts --runInBand --config test/migration/jest.config.json`

Expected: FAIL because the owner map and generated modules do not exist.

- [x] **Step 3: Generate exact artifacts with Nest CLI**

Generate a module, controller, and service for each of `posts`, `comments`, `status`, `explore`, `notifications`, `reports`, plus the chain port class, recording each command in the ledger.

Assign each model to its feature owner (`Post`/`Bookmark` to `posts`, `Comment` to `comments`, `Status` to `status`, `Notification` to `notifications`, `Report` to `reports`) and each route to the feature owning its path prefix.

- [x] **Step 4: Run ownership GREEN**

Expected: 52 assigned, zero missing, zero duplicate, six modules imported by `AppModule`.

### Task 2: Add strict content contracts

**Files:** Create `src/posts/post.contract.ts`, `src/comments/comment.contract.ts`, `src/status/status.contract.ts`, `src/notifications/notification.contract.ts`, `src/reports/report.contract.ts`, `src/posts/visibility.policy.ts`; test `test/content-social/contracts.spec.ts`.

**Interfaces:** Produces non-null `PostView`, `PostPage`, `PostCreate`, `PostUpdate`, `PostPrivacy`, `CommentView`, `CommentPage`, `StatusView`, `NotificationView`, `NotificationSettings`, `ReportCreate`, and `ModerationDecision` parsers plus `canViewPost`.

- [x] **Step 1: Write contracts RED**

```ts
expect(parsePostListQuery({ page: '0', limit: '500' })).toEqual({ page: 1, limit: 50 });
expect(() => parsePostCreate({})).toThrow('content');
expect(() => parsePostUpdate({ authorId: 'victim' })).toThrow('authorId');
expect(canViewPost({ privacy: 'followers' }, { isFollower: false, isOwner: false })).toBe(false);
```

- [x] **Step 2: Run RED**

Expected: FAIL on missing contract modules.

- [x] **Step 3: Implement strict Zod parsers and the visibility policy**

Bound every page and search term, require HTTPS media URLs, cap arrays and text, reject unknown mutation keys rather than stripping them, and express privacy, blocking, and not-interested as one pure policy function.

- [x] **Step 4: Run contracts GREEN**

Expected: all contracts return explicit values with no `undefined` and reject ownership and counter injection.

### Task 3: Migrate post lifecycle

**Files:** Create `src/posts/post-prisma.client.ts`; modify posts controller/service/module; test `test/content-social/posts-lifecycle.spec.ts`.

**Interfaces:** Produces `create`, `update`, `setPrivacy`, and `remove`. All routes use `SessionGuard`; deletion also asserts ownership.

- [ ] **Step 1: Write lifecycle RED**

```ts
await expect(service.update(other, postId, update)).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
await expect(service.remove(other, postId)).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
expect(await service.create(owner, input)).not.toHaveProperty('authorId', 'victim');
```

- [ ] **Step 2: Run RED, implement, then run GREEN**

Register exact routes `POST /api/posts/create`, `PUT /api/posts/:postId`, `PUT /api/posts/:postId/privacy`, `DELETE /api/posts/:id`. Preserve media handling and response fields; allow only reviewed mutable fields.

### Task 4: Migrate post reads and unshadow the two dead routes

**Files:** Modify posts controller/service and Prisma boundary; test `test/content-social/posts-reads.spec.ts`.

**Interfaces:** Produces `feed`, `search`, `byId`, `byUser`, `bookmarks`, `liked`, `mixed`, `videos`, and `reposts`.

- [ ] **Step 1: Write reads RED**

```ts
expect(routeOrder.indexOf('mixed')).toBeLessThan(routeOrder.indexOf(':postId'));
expect(await service.mixed(viewer, query)).toBeDefined();
expect((await service.feed(viewer, query)).posts).not.toContainEqual(expect.objectContaining({ id: blockedPostId }));
```

- [ ] **Step 2: Run RED, implement, then run GREEN**

`GET /api/posts/mixed` and `GET /api/posts/videos` are declared after `GET /:postId` in Express and are therefore unreachable today. Declare every literal path before the parametric one so both become reachable, and record the reachability change in the compatibility document. Apply the shared visibility policy and bounded pagination to every read.

### Task 5: Migrate post interactions

**Files:** Modify posts service/controller and Prisma boundary; test `test/content-social/posts-interactions.spec.ts`.

**Interfaces:** Produces `like`, `view`, `bookmark`, `notInterested`, `repost`, `shareToStatus`, and `promote`.

- [ ] **Step 1: Write interactions RED**

```ts
await expect(Promise.all([service.like(viewer, postId), service.like(viewer, postId)])).resolves.toEqual([
  expect.objectContaining({ liked: true }),
  expect.objectContaining({ liked: false }),
]);
expect(transactionOptions).toContainEqual({ isolationLevel: 'Serializable' });
```

- [ ] **Step 2: Run RED, implement, then run GREEN**

Counter and toggle transitions use serializable transactions with bounded P2034 retry so like, view, bookmark, and repost counts cannot be lost. Blocked interactions are refused. Idempotent repeats return the current state rather than double-counting.

### Task 6: Migrate comments

**Files:** Create `src/comments/comment-prisma.client.ts`; modify comments controller/service/module; test `test/content-social/comments.spec.ts`.

**Interfaces:** Produces `create`, `reply`, `like`, `listForPost`, and `listReplies`, each honouring the post visibility policy and the blocking rules the legacy `BlockingMiddleware.checkPostInteraction` applied.

- [ ] **Step 1: Write RED, implement, then run GREEN**

Register exact routes `POST /api/comments/:postId`, `POST /api/comments/reply/:commentId`, `POST /api/comments/like/:commentId`, `GET /api/comments/replies/:commentId`, `GET /api/comments/:postId`. Bound reply depth and page size.

### Task 7: Migrate ephemeral status

**Files:** Create `src/status/status-prisma.client.ts`; modify status controller/service/module; test `test/content-social/status.spec.ts`.

**Interfaces:** Produces `create`, `list`, `remove`, `react`, and `reshare`, preserving expiry semantics and viewer scoping.

- [ ] **Step 1: Write RED, implement, then run GREEN**

Register exact routes `POST /api/status`, `GET /api/status`, `DELETE /api/status/:id`, `POST /api/status/:id/react`, `POST /api/status/:id/reshare`. Expired status is never returned; deletion and reshare assert ownership and visibility.

### Task 8: Migrate explore and notifications

**Files:** Create `src/notifications/notification-prisma.client.ts`; modify explore and notifications slices; test `test/content-social/explore-notifications.spec.ts`.

**Interfaces:** Produces `explore(viewer, query)` plus `settings`, `updateSettings`, `registerPushToken`, `list`, `unreadCount`, `markRead`, `markAllRead`, and `remove`.

- [ ] **Step 1: Write RED, implement, then run GREEN**

Register the exact eight notification routes and `GET /api/explore`. Notification reads and mutations are strictly owner-scoped; a push token is validated and never logged. Explore ranking preserves the legacy ordering inputs under the shared visibility policy.

### Task 9: Migrate reporting and administrator moderation

**Files:** Create `src/reports/report-prisma.client.ts`; modify reports slice; test `test/content-social/reports.spec.ts`.

**Interfaces:** Produces `create`, `listForReview`, `warn`, and `ban`, guarded by `SessionGuard`, `RoleGuard`, and `TwoFactorGuard` for moderation.

- [ ] **Step 1: Write privilege RED, implement, then run GREEN**

Register exact routes `POST /api/reports`, `GET /api/reports`, `POST /api/reports/:userId/warn`, `POST /api/reports/:userId/ban`. Moderation records the actor, time, and a bounded required reason, and returns no internal field names. A ban is idempotent.

### Task 10: Close the content-social cutover unit

**Files:** Modify manifest, corrections register, compatibility docs, coverage test; create `test/content-social/cutover.spec.ts`.

**Interfaces:** Produces auditable 52/52 closure and zero Express-style content implementation.

- [ ] **Step 1: Write cutover RED**

```ts
expect(routeSet).toEqual(expectedFortySixRoutes);
expect(coverage).toEqual({ assigned: 52, missing: 0, duplicate: 0, unresolved: 0 });
expect(source).not.toMatch(/req\.body|catch \(error\) \{[^}]*error\.message/);
```

- [ ] **Step 2: Complete correction and client documentation**

Document the two newly reachable post routes, the bounded pagination defaults, the visibility policy, the moderation reason requirement, and the deferred `ContentChainPort` adapter. Mark the manifest implemented at 52/52 without claiming programme completion.

- [ ] **Step 3: Run domain and preceding-domain gates**

Run the content-social, ads-media, auth-users-security, and migration suites, full ESLint, strict source and test type checks, Prettier, `prisma validate --config prisma.config.ts`, and `nest build -b swc`.

Expected: all pass; Prisma uses a dummy non-routable URL and executes no SQL.

## Deferred integration gate

`POST /api/posts/:postId/anchor`, `POST /api/posts/:postId/mint-as-nft`, and `GET /api/posts/:postId/verify` are owned by this domain, but the `provider:aeko-chain:*` and `provider:ipfs:*` capabilities they call belong to the `chain` domain (order 9). This plan implements the routes, request contracts, authorization, and persistence against a typed `ContentChainPort`; until the chain domain lands, the installed adapter returns a fixed `PROVIDER_UNAVAILABLE`. Task 10 records this as an explicit open gate rather than claiming on-chain parity.

## Self-Review

- Spec coverage: all 52 IDs map to one task and one owner; no provider or route is invented.
- Security coverage: ownership, admin/2FA moderation, blocking, privacy, bounded reads, transactional counters, and safe errors are explicit.
- Type consistency: all JSON is parsed into explicit immutable contracts; no raw request object reaches a service.
- Programme boundary: AdminJS/UI is untouched; chain integration is deferred by design; whole-backend battle tests and independent review remain after all ten domains.
