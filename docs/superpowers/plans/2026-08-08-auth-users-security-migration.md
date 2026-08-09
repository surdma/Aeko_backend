# Auth, Users, Profiles, and Security Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the complete active auth-users-security capability manifest into strict NestJS modules while keeping native Better Auth as the only authentication implementation.

**Architecture:** Better Auth continues to own `/api/auth/**`, sessions, password recovery, Google OAuth, bearer authentication, and two-factor authentication through its native handler and official tables. Nest feature modules own user reads, profile lifecycle, social privacy, blocking, follow requests, verification eligibility, security events, and media ports; controllers remain thin and services use the lifecycle-owned `PrismaService`. Every legacy capability is closed by either a native Nest endpoint or the approved native Better Auth cutover correction.

**Tech Stack:** NestJS 11, TypeScript strict mode, Prisma ORM 7 with PostgreSQL adapter, Better Auth 1.6, Zod, Jest/Supertest, Nest CLI.

## Global Constraints

- Treat `docs/nestjs-migration/domains/auth-users-security.json` as the exact 60-capability scope and `C:/Users/olaitan/Dev/aeko/backend` as read-only behavioral evidence.
- Do not recreate legacy JWT, bcrypt, Passport, custom session, custom 2FA-secret, or compatibility auth controllers.
- Use only the official Better Auth `User`, `Session`, `Account`, `Verification`, and `TwoFactor` storage already proven in `prisma/better-auth.generated.prisma`.
- Keep one lifecycle-owned Prisma client; no feature may instantiate `PrismaClient` or `PrismaPg`.
- Do not use `any`, double casts, non-null assertions, raw unvalidated request objects, or nullable return contracts.
- Generate every new Nest module, controller, service, guard, interceptor, and pipe with the Nest CLI and record the exact command in `docs/nestjs-migration/nest-cli-ledger.md`.
- Correct security defects as documented migration exceptions: ownership, administrator authorization, rate limiting, secret disclosure, unsafe provider errors, and replay-prone flows must not be preserved.
- Do not execute migration SQL or connect to a real database during implementation.
- The full legacy-vs-Nest endpoint battle test and independent review remain programme-final gates after all domain migrations; this plan still requires focused RED/GREEN tests for every task.

---

## File Structure

- `src/users/`: public user lookup/listing/deletion policies and response projections.
- `src/profiles/`: current-user profile, activity, eligibility, follow graph, and account-domain operations.
- `src/security/`: blocking, privacy, follow requests, security events/statistics, and administrator verification.
- `src/providers/media/`: Cloudinary-independent upload port and adapter boundary.
- `src/common/pagination/`: shared validated page/limit parsing and non-null page metadata.
- `test/migration/auth-users-security-coverage.spec.ts`: exact manifest-to-owner closure.
- `test/auth-users-security/`: controller/service/security regression suites.

### Task 1: Generate the feature skeleton and lock capability ownership

**Files:**

- Create: `src/users/users.module.ts`, `src/users/users.controller.ts`, `src/users/users.service.ts`
- Create: `src/profiles/profiles.module.ts`, `src/profiles/profiles.controller.ts`, `src/profiles/profiles.service.ts`
- Create: `src/security/security.module.ts`, `src/security/security.controller.ts`, `src/security/security.service.ts`
- Create: `src/providers/media/media.module.ts`, `src/providers/media/cloudinary-media.adapter.ts`
- Modify: `src/app.module.ts`
- Modify: `docs/nestjs-migration/nest-cli-ledger.md`
- Create: `docs/nestjs-migration/domains/auth-users-security-owners.json`
- Test: `test/migration/auth-users-security-coverage.spec.ts`

**Interfaces:**

- Consumes: `docs/nestjs-migration/domains/auth-users-security.json`.
- Produces: one declared owner for each capability and generated Nest feature boundaries imported by `AppModule`.

- [x] **Step 1: Write the failing ownership test**

```ts
expect(manifest.capabilityIds).toHaveLength(60);
expect(new Set(Object.keys(ownerMap))).toEqual(new Set(manifest.capabilityIds));
expect(Object.values(ownerMap).every((owners) => owners.length === 1)).toBe(
  true,
);
expect(ownerMap['rest:POST:/api/auth/login:routes/auth.js:881']).toEqual([
  'better-auth-native-cutover',
]);
```

- [x] **Step 2: Run the test and verify RED**

Run: `.\\node_modules\\.bin\\jest.cmd test/migration/auth-users-security-coverage.spec.ts --runInBand --config test/migration/jest.config.json`

Expected: FAIL because the owner map and generated modules do not exist.

- [x] **Step 3: Generate every Nest artifact with the CLI**

```powershell
.\node_modules\.bin\nest.cmd generate module users --no-spec
.\node_modules\.bin\nest.cmd generate controller users --no-spec
.\node_modules\.bin\nest.cmd generate service users --no-spec
.\node_modules\.bin\nest.cmd generate module profiles --no-spec
.\node_modules\.bin\nest.cmd generate controller profiles --no-spec
.\node_modules\.bin\nest.cmd generate service profiles --no-spec
.\node_modules\.bin\nest.cmd generate module security --no-spec
.\node_modules\.bin\nest.cmd generate controller security --no-spec
.\node_modules\.bin\nest.cmd generate service security --no-spec
.\node_modules\.bin\nest.cmd generate module providers/media --no-spec
.\node_modules\.bin\nest.cmd generate class providers/media/cloudinary-media.adapter --no-spec
```

Record each successful command and generated path in the CLI ledger. Define `ownerMap` as a checked-in `Readonly<Record<CapabilityId, readonly [CapabilityOwner]>>`; assign legacy auth, legacy users register/login, legacy 2FA route IDs, the email provider, and the Google OAuth provider to `better-auth-native-cutover`. Assign Cloudinary to `media`, the three models to their owning feature, and every remaining route to `users`, `profiles`, or `security`.

- [x] **Step 4: Run coverage GREEN and commit**

Run the Step 2 command. Expected: PASS with 60 capabilities, zero missing, zero duplicate owners.

```powershell
git add -- src/users src/profiles src/security src/providers/media src/app.module.ts docs/nestjs-migration/nest-cli-ledger.md docs/nestjs-migration/domains/auth-users-security-owners.json test/migration/auth-users-security-coverage.spec.ts
git commit -m "feat: scaffold auth users security migration"
```

### Task 2: Add strict shared request and projection contracts

**Files:**

- Create: `src/common/pagination/page-query.ts`
- Create: `src/users/user.contract.ts`
- Create: `src/profiles/profile.contract.ts`
- Create: `src/security/security.contract.ts`
- Test: `test/auth-users-security/contracts.spec.ts`

**Interfaces:**

- Consumes: controller query/body values of type `unknown`.
- Produces: `PageQuery`, `UserSummary`, `UserProfile`, `PrivacySettings`, `FollowRequestStatus`, and Zod parsers that either return fully defined values or throw `DomainError.validation`.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(parsePageQuery({ page: '0', limit: '500' })).toEqual({
  page: 1,
  limit: 100,
});
expect(() => parsePrivacySettings({ profileVisibility: 'friends' })).toThrow(
  'profileVisibility',
);
expect(parseUserSearch({ search: '  Ada  ' })).toEqual({ search: 'Ada' });
expect(
  Object.values(projectUser(userFixture)).some((value) => value === undefined),
).toBe(false);
```

- [ ] **Step 2: Run contracts RED**

Run: `.\\node_modules\\.bin\\jest.cmd test/auth-users-security/contracts.spec.ts --runInBand --config test/auth/jest.config.json`

Expected: FAIL on missing contract modules.

- [ ] **Step 3: Implement explicit non-null contracts**

```ts
export interface PageQuery {
  readonly page: number;
  readonly limit: number;
}
export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly pages: number;
}
export type ProfileVisibility = 'public' | 'private';
export interface PrivacySettings {
  readonly profileVisibility: ProfileVisibility;
  readonly showFollowers: boolean;
  readonly showFollowing: boolean;
  readonly allowMessages: boolean;
  readonly allowFollowRequests: boolean;
}
export type FollowRequestStatus = 'pending' | 'accepted' | 'rejected';
```

Use Zod defaults for absent persisted JSON keys, cap `limit` at 100, normalize empty search to `''`, and map optional database values to explicit `null` in response DTOs. Never return password/account/session/provider secrets or raw Prisma records.

- [ ] **Step 4: Run contracts GREEN and commit**

```powershell
git add -- src/common/pagination src/users/user.contract.ts src/profiles/profile.contract.ts src/security/security.contract.ts test/auth-users-security/contracts.spec.ts
git commit -m "feat: add strict user security contracts"
```

### Task 3: Migrate public users and protected deletion

**Files:**

- Modify: `src/users/users.controller.ts`
- Modify: `src/users/users.service.ts`
- Modify: `src/users/users.module.ts`
- Test: `test/auth-users-security/users.spec.ts`

**Interfaces:**

- Consumes: `PrismaService`, `AuthenticatedPrincipal`, `PageQuery`, privacy/block decisions.
- Produces: `getUser(viewerId, targetId)`, `listUsers(viewerId, query)`, `followers(viewerId, targetId, query)`, `following(viewerId, targetId, query)`, and `deleteUser(principal, targetId)`.

- [ ] **Step 1: Write controller and service RED tests**

```ts
await expect(
  service.deleteUser(memberPrincipal, anotherUserId),
).rejects.toMatchObject({
  code: 'AUTHORIZATION_DENIED',
});
expect(await service.deleteUser(adminPrincipal, anotherUserId)).toEqual({
  deleted: true,
});
expect(
  await service.listUsers(viewerId, { page: 1, limit: 20, search: '' }),
).toEqual({
  items: [publicUser],
  page: { page: 1, limit: 20, total: 1, pages: 1 },
});
```

- [ ] **Step 2: Run users RED**

Run: `.\\node_modules\\.bin\\jest.cmd test/auth-users-security/users.spec.ts --runInBand --config test/auth/jest.config.json`

Expected: FAIL because generated service methods are absent.

- [ ] **Step 3: Implement endpoints and policies**

```ts
@Get(':id') getUser(@CurrentUser() user: AuthenticatedPrincipal, @Param('id') id: string): Promise<UserProfile>
@Get() list(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: unknown): Promise<UserPage>
@Get(':id/followers') followers(...): Promise<UserPage>
@Get(':id/following') following(...): Promise<UserPage>
@Delete(':id') @UseGuards(SessionGuard, RoleGuard) delete(...): Promise<{ readonly deleted: true }>
```

Register `UsersController` under `/api/users`. Preserve pagination/search/filter semantics, enforce block and privacy visibility before returning records, allow account deletion only for self with satisfied 2FA or administrator, and perform dependent deletion through Prisma referential actions/one transaction. Do not restore `/api/users/register` or `/api/users/login`; those are owned by native Better Auth cutover.

- [ ] **Step 4: Run users GREEN and commit**

```powershell
git add -- src/users test/auth-users-security/users.spec.ts
git commit -m "feat: migrate users endpoints"
```

### Task 4: Migrate current-user profile, activity, and eligibility

**Files:**

- Modify: `src/profiles/profiles.controller.ts`
- Modify: `src/profiles/profiles.service.ts`
- Modify: `src/profiles/profiles.module.ts`
- Test: `test/auth-users-security/profiles.spec.ts`

**Interfaces:**

- Consumes: current principal, Better Auth password APIs, `VerificationSettings`, profile JSON projection.
- Produces: `getCurrent`, `getActivity`, `update`, `changePassword`, `deleteAccount`, and `eligibility`.

- [ ] **Step 1: Write profile behavior RED tests**

```ts
expect(await service.eligibility(completeUserId)).toEqual({
  eligible: true,
  requirements: {
    followers: true,
    posts: true,
    profilePicture: true,
    coverPicture: true,
    bio: true,
  },
});
await expect(
  service.update(principal, { email: 'taken@example.com' }),
).rejects.toMatchObject({
  code: 'CONFLICT',
});
await expect(
  service.deleteAccount(twoFactorIncompletePrincipal),
).rejects.toMatchObject({
  code: 'TWO_FACTOR_REQUIRED',
});
```

- [ ] **Step 2: Run profiles RED**

Run: `.\\node_modules\\.bin\\jest.cmd test/auth-users-security/profiles.spec.ts --runInBand --config test/auth/jest.config.json`

Expected: FAIL on missing profile operations.

- [ ] **Step 3: Implement strict profile endpoints**

```ts
@Get() get(@CurrentUser() user: AuthenticatedPrincipal): Promise<CurrentProfile>
@Get('activity') activity(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: unknown): Promise<ActivityPage>
@Put('update') @UseGuards(SessionGuard, TwoFactorGuard) update(...): Promise<CurrentProfile>
@Put('change-password') @UseGuards(SessionGuard, TwoFactorGuard) changePassword(...): Promise<{ readonly changed: true }>
@Delete('delete-account') @UseGuards(SessionGuard, TwoFactorGuard) deleteAccount(...): Promise<{ readonly deleted: true }>
@Get('eligibility') eligibility(@CurrentUser() user: AuthenticatedPrincipal): Promise<VerificationEligibility>
```

Register under `/api/profile`. Delegate password change and account/session invalidation to Better Auth APIs instead of reading credential hashes. Preserve activity ordering and eligibility thresholds from `VerificationSettings`; when no settings row exists, use the schema defaults `1000/10/true/true/true/true` without returning `undefined`.

- [ ] **Step 4: Run profiles GREEN and commit**

```powershell
git add -- src/profiles test/auth-users-security/profiles.spec.ts
git commit -m "feat: migrate profile lifecycle"
```

### Task 5: Migrate profile media through a provider port

**Files:**

- Create: `src/providers/media/media.port.ts`
- Modify: `src/providers/media/cloudinary-media.adapter.ts`
- Modify: `src/providers/media/media.module.ts`
- Modify: `src/users/users.controller.ts`
- Modify: `src/users/users.service.ts`
- Test: `test/auth-users-security/profile-media.spec.ts`

**Interfaces:**

- Consumes: validated image buffer, MIME type, principal ID.
- Produces: `MediaPort.uploadProfileImage(input): Promise<UploadedMedia>` and protected picture endpoints.

- [ ] **Step 1: Write media security RED tests**

```ts
await expect(
  service.updateProfilePicture(principal, executableFile),
).rejects.toMatchObject({
  code: 'VALIDATION_FAILED',
});
expect(await service.updateCoverPicture(principal, pngFile)).toEqual({
  coverPicture: 'https://media.example/users/u1/cover.png',
});
expect(media.uploadCalls[0]).toMatchObject({ ownerId: 'u1', purpose: 'cover' });
```

- [ ] **Step 2: Run media RED**

Run: `.\\node_modules\\.bin\\jest.cmd test/auth-users-security/profile-media.spec.ts --runInBand --config test/auth/jest.config.json`

Expected: FAIL on missing media port.

- [ ] **Step 3: Implement bounded uploads**

```ts
export type MediaPurpose = 'profile' | 'cover';
export interface UploadImageInput {
  readonly ownerId: string;
  readonly purpose: MediaPurpose;
  readonly bytes: Uint8Array;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}
export interface UploadedMedia {
  readonly url: string;
  readonly providerId: string;
}
export abstract class MediaPort {
  abstract uploadProfileImage(input: UploadImageInput): Promise<UploadedMedia>;
}
```

Add `PUT /api/users/profile-picture` and `PUT /api/users/cover-picture` guarded by session and 2FA. Limit uploads to 5 MiB, reject unapproved MIME types before provider invocation, do not expose provider exceptions, and save only the returned HTTPS URL after successful upload.

- [ ] **Step 4: Run media GREEN and commit**

```powershell
git add -- src/providers/media src/users test/auth-users-security/profile-media.spec.ts
git commit -m "feat: migrate protected profile media"
```

### Task 6: Migrate privacy, blocking, follows, and follow requests

**Files:**

- Modify: `src/security/security.controller.ts`
- Modify: `src/security/security.service.ts`
- Modify: `src/security/security.module.ts`
- Modify: `src/profiles/profiles.controller.ts`
- Modify: `src/profiles/profiles.service.ts`
- Test: `test/auth-users-security/social-security.spec.ts`

**Interfaces:**

- Consumes: current principal and normalized JSON-backed privacy/follow collections.
- Produces: atomic block/unblock, follow/unfollow, follow-request decisions, and filtered follower/following pages.

- [ ] **Step 1: Write concurrency and ownership RED tests**

```ts
await expect(service.block(userId, userId, null)).rejects.toMatchObject({
  code: 'VALIDATION_FAILED',
});
expect(await Promise.all([service.follow(a, b), service.follow(a, b)])).toEqual(
  [{ state: 'following' }, { state: 'following' }],
);
await expect(
  service.resolveFollowRequest(recipientB, requesterA, 'accepted'),
).resolves.toEqual({
  status: 'accepted',
});
await expect(
  service.resolveFollowRequest(unrelatedC, requesterA, 'accepted'),
).rejects.toMatchObject({
  code: 'AUTHORIZATION_DENIED',
});
```

- [ ] **Step 2: Run social-security RED**

Run: `.\\node_modules\\.bin\\jest.cmd test/auth-users-security/social-security.spec.ts --runInBand --config test/auth/jest.config.json`

Expected: FAIL because operations do not exist.

- [ ] **Step 3: Implement controllers and transactional state transitions**

```ts
@Post('block/:userId') block(...): Promise<BlockResult>
@Delete('block/:userId') unblock(...): Promise<BlockResult>
@Get('blocked') blocked(...): Promise<UserPage>
@Get('block-status/:userId') blockStatus(...): Promise<BlockStatus>
@Put('privacy') updatePrivacy(...): Promise<PrivacySettings>
@Get('privacy') privacy(...): Promise<PrivacySettings>
@Post('follow-request/:userId') requestFollow(...): Promise<FollowState>
@Put('follow-request/:requesterId') resolveFollow(...): Promise<FollowState>
@Get('follow-requests') requests(...): Promise<FollowRequestPage>
```

Also implement `/api/profile/follow/:id`, `/unfollow/:id`, `/followers`, `/following`, and `/followers/search`. Use an interactive Prisma transaction for symmetric follower/following changes, make repeated operations idempotent, deny self-block/self-follow, remove follow relationships on block, require recipient ownership for request resolution, and never reveal private lists to unauthorized viewers.

- [ ] **Step 4: Run social-security GREEN and commit**

```powershell
git add -- src/security src/profiles test/auth-users-security/social-security.spec.ts
git commit -m "feat: migrate privacy blocks and follows"
```

### Task 7: Migrate verification and security audit reporting

**Files:**

- Create: `src/security/security-event.service.ts`
- Modify: `src/security/security.controller.ts`
- Modify: `src/security/security.service.ts`
- Modify: `src/security/security.module.ts`
- Modify: `src/profiles/profiles.controller.ts`
- Test: `test/auth-users-security/security-events.spec.ts`

**Interfaces:**

- Consumes: `SecurityEvent`, `VerificationSettings`, request context, administrator principal.
- Produces: append-only sanitized events, event page/statistics, eligibility verification decision.

- [ ] **Step 1: Write audit and privilege RED tests**

```ts
await expect(
  service.verifyUser(memberPrincipal, targetId, true),
).rejects.toMatchObject({
  code: 'AUTHORIZATION_DENIED',
});
expect(
  await service.verifyUser(adminTwoFactorPrincipal, targetId, false),
).toEqual({ verified: true });
expect(JSON.stringify(await events.list(ownerId, query))).not.toContain(
  'raw-secret',
);
expect(await events.stats(ownerId, 30)).toEqual(
  expect.objectContaining({ total: expect.any(Number) }),
);
```

- [ ] **Step 2: Run security-events RED**

Run: `.\\node_modules\\.bin\\jest.cmd test/auth-users-security/security-events.spec.ts --runInBand --config test/auth/jest.config.json`

Expected: FAIL on missing event service and authorization.

- [ ] **Step 3: Implement append-only audit behavior**

```ts
export interface RecordSecurityEventInput {
  readonly userId: string;
  readonly eventType: string;
  readonly targetUserId: string | null;
  readonly success: boolean;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}
```

Add `GET /api/security/events`, `GET /api/security/stats`, and `POST /api/profile/verify`. Restrict verification to administrators with a satisfied 2FA session, ignore the legacy caller-controlled `force` bypass for non-admins, calculate eligibility server-side, and record success/failure without credentials, tokens, secrets, raw provider errors, or full request bodies.

- [ ] **Step 4: Run security-events GREEN and commit**

```powershell
git add -- src/security src/profiles test/auth-users-security/security-events.spec.ts
git commit -m "feat: migrate verification and security audit"
```

### Task 8: Close native Better Auth cutover and the domain gate

**Files:**

- Modify: `docs/nestjs-migration/auth-compatibility.md`
- Modify: `docs/nestjs-migration/corrections.json`
- Modify: `docs/nestjs-migration/domains/auth-users-security.json`
- Modify: `test/migration/auth-users-security-coverage.spec.ts`
- Create: `test/auth-users-security/cutover.spec.ts`

**Interfaces:**

- Consumes: all feature controllers/services and native Better Auth route inventory.
- Produces: auditable closure for exactly 60 capabilities and zero legacy auth implementation.

- [ ] **Step 1: Write the final cutover RED tests**

```ts
expect(findCompatibilityAuthControllers()).toEqual([]);
expect(findLegacyAuthImports()).toEqual([]);
expect(nativeCutoverIds).toEqual(expectedLegacyAuthAndTwoFactorCapabilityIds);
expect(await probeOwnedRoutes(application)).toEqual(expectedNestRouteSet);
expect(coverage).toEqual({
  assigned: 60,
  missing: 0,
  duplicate: 0,
  unresolved: 0,
});
```

- [ ] **Step 2: Run the complete focused domain suite**

Run: `.\\node_modules\\.bin\\jest.cmd test/auth-users-security test/migration/auth-users-security-coverage.spec.ts --runInBand --config test/auth/jest.config.json`

Expected before closure: FAIL on incomplete route/correction evidence.

- [ ] **Step 3: Complete cutover documentation and safety scans**

Document native Better Auth replacements for legacy signup/login/logout/me/email-verification/password-reset/Google/2FA operations, exact client request/response/cookie changes, and the administrator/ownership/rate-limit/security-event corrections. Verify the source contains no compatibility `/api/auth` controller, bcrypt/JWT/Passport imports, second Prisma client, `any`, unsafe casts, non-null assertions, or raw secret logging.

- [ ] **Step 4: Run all domain and foundation gates**

```powershell
.\node_modules\.bin\jest.cmd test/auth-users-security test/migration/auth-users-security-coverage.spec.ts --runInBand --config test/auth/jest.config.json
.\node_modules\.bin\jest.cmd test/auth test/foundation test/migration/prisma-schema.spec.ts --runInBand
.\node_modules\.bin\eslint.cmd "{src,test,scripts}/**/*.{ts,mts}" --max-warnings=0
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
.\node_modules\.bin\prisma.cmd validate --config prisma.config.ts
.\node_modules\.bin\nest.cmd build -b swc
```

Expected: focused tests PASS, manifest closure `60/60`, ESLint exit 0, TypeScript exit 0, Prisma schema valid, Nest build TSC 0 issues. Prisma validation uses a dummy non-routable URL and must not execute SQL.

- [ ] **Step 5: Commit the completed cutover unit**

```powershell
git add -- src/users src/profiles src/security src/providers/media src/common/pagination test/auth-users-security test/migration/auth-users-security-coverage.spec.ts docs/nestjs-migration/auth-compatibility.md docs/nestjs-migration/corrections.json docs/nestjs-migration/domains/auth-users-security.json
git commit -m "feat: complete auth users security migration"
```

## Self-Review

- Spec coverage: all 60 manifest capabilities have a task and exactly one owner; native auth/2FA routes plus email and Google OAuth providers close through the approved Better Auth correction, while users/profiles/security/media close through Nest modules.
- Security coverage: self/ownership/admin checks, 2FA elevation, upload validation, transactional follow state, event redaction, provider error sanitization, and removal of caller-controlled verification bypass are explicit.
- Placeholder scan: no deferred implementation markers or unspecified test steps remain.
- Type consistency: controller/service names, `AuthenticatedPrincipal`, page contracts, media port, privacy types, and security-event input are defined before consumers.
- Programme boundary: AdminJS/UI is untouched; final whole-backend parity battle testing and independent review remain after every domain plan is implemented.
