# Ads and Media Editing Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 16 active `ads-media` capabilities into strict NestJS ad and media-processing modules without changing successful client behavior, while correcting the legacy status-field, ownership, concurrency, upload, and raw-error defects.

**Architecture:** `AdsModule` owns ad lifecycle, targeting, dashboards, review, and analytics through one lifecycle-owned Prisma client and explicit JSON contracts. `MediaProcessingModule` owns authenticated bounded photo/video editing through provider ports; Sharp is an explicit image dependency and FFmpeg is invoked through a bounded child-process adapter with a friendly unavailable result when the host binary is absent. Tracking writes use serializable interactive transactions with P2034 retry so JSON counters and budget cannot lose concurrent updates.

**Tech Stack:** NestJS 11, TypeScript strict mode, Prisma ORM 7, Zod 4, Better Auth principals/guards, Sharp, Node child processes, Jest.

## Global Constraints

- Treat `docs/nestjs-migration/domains/ads-media.json` as the exact 16-capability scope and `C:/Users/olaitan/Dev/aeko/backend` as read-only behavioral evidence.
- Preserve the canonical `Ad` table and JSON fields; do not execute migration SQL or connect to a real database.
- Keep native Better Auth as the only authentication implementation and the existing `SessionGuard`, `RoleGuard`, and `TwoFactorGuard` as authorization inputs.
- Keep one lifecycle-owned Prisma client; no feature may instantiate `PrismaClient` or `PrismaPg`.
- Do not use `any`, double casts, non-null assertions, raw request objects, unbounded uploads, shell command strings, synchronous filesystem writes, or raw provider/database errors.
- Generate every new Nest module, controller, service, and port/adapter class with the Nest CLI and record the exact command in `docs/nestjs-migration/nest-cli-ledger.md`.
- Correct and document legacy defects: mixed `status`/`Status`, unrestricted update bodies, analytics lost updates, missing editing authentication/limits, unsafe local filenames, and raw processing errors.
- AdminJS and all UI remain out of scope. Final whole-backend battle testing and independent review remain programme-final gates after all domains.

---

## File Structure

- `src/ads/`: ad contracts, controller, service, Prisma boundary, targeting and analytics policy.
- `src/providers/media-processing/`: editing controller/service plus image/video processor ports and adapters.
- `test/ads-media/`: focused contracts, ads, tracking, administration, editing, and cutover suites.
- `docs/nestjs-migration/domains/ads-media-owners.json`: exactly one owner for each of 16 capabilities.

### Task 1: Generate boundaries and lock exact ownership

**Files:**

- Create: `src/ads/ads.module.ts`, `src/ads/ads.controller.ts`, `src/ads/ads.service.ts`
- Create: `src/providers/media-processing/media-processing.module.ts`, `media-processing.controller.ts`, `media-processing.service.ts`
- Create: `src/providers/media-processing/image-processor.port.ts`, `video-processor.port.ts`, `sharp-image.adapter.ts`, `ffmpeg-video.adapter.ts`
- Modify: `src/app.module.ts`, `docs/nestjs-migration/nest-cli-ledger.md`
- Create: `docs/nestjs-migration/domains/ads-media-owners.json`
- Test: `test/migration/ads-media-coverage.spec.ts`

**Interfaces:** Consumes the committed 16-ID manifest. Produces one owner tuple per capability and two AppModule-imported feature modules.

- [x] **Step 1: Write ownership RED**

```ts
expect(manifest.capabilityIds).toHaveLength(16);
expect(new Set(Object.keys(owners))).toEqual(new Set(manifest.capabilityIds));
expect(Object.values(owners).every((value) => value.length === 1)).toBe(true);
expect(ownerCounts).toEqual({ ads: 14, 'media-processing': 2 });
```

- [x] **Step 2: Run RED**

Run: `.\node_modules\.bin\jest.cmd test/migration/ads-media-coverage.spec.ts --runInBand --config test/migration/jest.config.json`

Expected: FAIL because owner map and generated modules do not exist.

- [x] **Step 3: Generate exact artifacts with Nest CLI**

```powershell
.\node_modules\.bin\nest.cmd generate module ads --no-spec
.\node_modules\.bin\nest.cmd generate controller ads --no-spec
.\node_modules\.bin\nest.cmd generate service ads --no-spec
.\node_modules\.bin\nest.cmd generate module providers/media-processing --no-spec
.\node_modules\.bin\nest.cmd generate controller providers/media-processing --no-spec
.\node_modules\.bin\nest.cmd generate service providers/media-processing --no-spec
.\node_modules\.bin\nest.cmd generate class providers/media-processing/image-processor.port --no-spec --flat
.\node_modules\.bin\nest.cmd generate class providers/media-processing/video-processor.port --no-spec --flat
.\node_modules\.bin\nest.cmd generate class providers/media-processing/sharp-image.adapter --no-spec --flat
.\node_modules\.bin\nest.cmd generate class providers/media-processing/ffmpeg-video.adapter --no-spec --flat
```

Assign `model:model:Ad` and all thirteen `/api/ads/**` IDs to `ads`; assign photo/video edit IDs to `media-processing`.

- [x] **Step 4: Run ownership GREEN**

Expected: 16 assigned, zero missing, zero duplicate, modules imported by `AppModule`.

### Task 2: Add strict Ad and processing contracts

**Files:** Create `src/ads/ad.contract.ts`, `src/providers/media-processing/media-processing.contract.ts`; test `test/ads-media/contracts.spec.ts`.

**Interfaces:** Produces non-null `AdView`, `AdPage`, `AdCreate`, `AdUpdate`, `AdTargeting`, `AdBudget`, `AdPricing`, `AdCampaign`, `AdAnalytics`, `TrackEvent`, `ReviewDecision`, `ImageEffect`, and `VideoEffect` parsers.

- [x] **Step 1: Write contracts RED**

```ts
expect(parseAdListQuery({ page: '0', limit: '500' })).toEqual({ page: 1, limit: 100, status: null });
expect(() => parseAdCreate({ title: 'x' }, now)).toThrow('campaign');
expect(() => parseAdUpdate({ advertiserId: 'victim' })).toThrow('advertiserId');
expect(parseTrackEvent({ adId: ' a1 ', metadata: {} }).adId).toBe('a1');
```

- [x] **Step 2: Run RED**

Run: `.\node_modules\.bin\jest.cmd test/ads-media/contracts.spec.ts --runInBand --config test/ads-media/jest.config.json`

Expected: FAIL on missing contract modules.

- [x] **Step 3: Implement strict Zod parsers**

Use API status values `draft|pending|approved|rejected|running|paused|completed|expired`, map only at the Prisma boundary to canonical column `Status`, require positive finite budgets and bids, require HTTPS media/CTA URLs, reject past starts and non-increasing schedules, cap strings/arrays, and strip no unknown mutation keys: reject them.

- [x] **Step 4: Run contracts GREEN**

Expected: all contracts return explicit values with no `undefined` and reject ownership/status/analytics injection.

### Task 3: Migrate ad lifecycle, targeting, and dashboard

**Files:** Create `src/ads/ad-prisma.client.ts`; modify ads controller/service/module; test `test/ads-media/ads.spec.ts`.

**Interfaces:** Produces `create`, `listOwned`, `targeted`, `dashboard`, `analytics`, `updateOwned`, and `deleteOwned`. All user routes use `SessionGuard`; delete also uses `TwoFactorGuard`.

- [x] **Step 1: Write lifecycle RED**

```ts
await expect(service.updateOwned(other, adId, update)).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
await expect(service.deleteOwned(ownerWithout2fa, adId)).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
expect((await service.listOwned(ownerId, query)).items[0]).not.toHaveProperty('Status');
expect(await service.targeted(userId, 5)).toEqual([highestEligibleBid]);
```

- [x] **Step 2: Run lifecycle RED**

Expected: FAIL because generated ads service has no behavior.

- [x] **Step 3: Implement lifecycle**

Register exact routes `POST/GET /api/ads`, `GET /targeted`, `GET /dashboard`, `GET /:adId/analytics`, `PUT/DELETE /:adId`. Preserve newest-first owner pages, location/follower targeting, bid ordering, time/budget eligibility, dashboard formulae, and legacy response field `status`; correct every internal `status` write/read to Prisma `Status`. Updates allow only title, description, approved media/targeting/budget/pricing/campaign/CTA/placement fields and legal owner status transitions.

- [x] **Step 4: Run lifecycle GREEN**

Expected: exact routes, ownership, 2FA deletion, targeting, dashboard, and safe projections pass.

### Task 4: Make tracking concurrency-safe and idempotency-ready

**Files:** Modify `src/ads/ad-prisma.client.ts`, `ads.service.ts`, `ads.controller.ts`; test `test/ads-media/tracking.spec.ts`.

**Interfaces:** Produces `trackImpression`, `trackClick`, `trackConversion`, and legacy alias `trackView`, using `Serializable` transactions and P2034 retry at most three attempts.

- [x] **Step 1: Write tracking RED**

```ts
await expect(Promise.all([service.track('impression', input), service.track('impression', input)])).resolves.toEqual([
  expect.objectContaining({ impressions: expect.any(Number) }),
  expect.objectContaining({ impressions: expect.any(Number) }),
]);
expect(transactionOptions).toContainEqual({ isolationLevel: 'Serializable' });
expect(attemptsAfterTwoP2034Failures).toBe(3);
```

- [x] **Step 2: Run tracking RED**

Expected: FAIL on missing transactional tracking.

- [x] **Step 3: Implement atomic counter/budget transitions**

Re-read inside each transaction, require `Status === 'running'` for impressions/clicks/conversions, update JSON analytics and budget without mutation, calculate numeric CTR/conversion/frequency, charge CPM each 1000th impression and CPC/CPA once per request, and set canonical `Status: 'completed'` when exhausted. `/track-view` invokes the same impression method.

- [x] **Step 4: Run tracking GREEN**

Expected: concurrent, retry, status, budget, malformed JSON, and sanitized failure tests pass.

### Task 5: Migrate administrator review

**Files:** Modify ads controller/service; test `test/ads-media/admin-review.spec.ts`.

**Interfaces:** Produces `listForReview(admin, query)` and `review(admin, adId, decision)` guarded by `SessionGuard`, `RoleGuard`, and `TwoFactorGuard` for mutation.

- [x] **Step 1: Write privilege RED**

```ts
await expect(service.review(member, adId, decision)).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
await expect(service.review(adminWithout2fa, adId, decision)).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
expect(await service.review(admin, adId, { status: 'approved', feedback: null })).toMatchObject({ status: 'running' });
```

- [x] **Step 2: Run RED, implement, then run GREEN**

Register exact `GET /api/ads/admin/review` and `POST /api/ads/admin/review/:adId`; accept only approved/rejected, require a bounded rejection reason when rejected, record reviewer/time/feedback, and return no internal Prisma field names.

### Task 6: Migrate bounded authenticated photo/video editing

**Files:** Modify media-processing module/controller/service/ports/adapters and configuration; modify package/lock for exact Sharp dependency; test `test/ads-media/media-processing.spec.ts`.

**Interfaces:** `ImageProcessorPort.process(input): Promise<ProcessedMedia>` and `VideoProcessorPort.process(input): Promise<ProcessedMedia>` accept validated temporary inputs and return bounded files/URLs. Controllers expose exact `POST /api/photo/edit` and `POST /api/video/edit`.

- [ ] **Step 1: Write processing RED**

```ts
await expect(service.editPhoto(executable, 'blur')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
await expect(service.editVideo(oversized, 'negate')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
expect(photoRouteGuards).toContain(SessionGuard);
expect(videoRouteGuards).toContain(SessionGuard);
```

- [ ] **Step 2: Run RED and install only the reviewed dependency**

Run: `corepack pnpm add sharp`

No fluent wrapper is added; invoke FFmpeg with `spawn(file, args, { shell: false })`, fixed argument arrays, 60-second timeout, and a validated configured executable name/path.

- [ ] **Step 3: Implement processing**

Use memory upload for photos (10 MiB) and bounded temporary disk storage for video (100 MiB); validate MIME plus magic bytes before provider calls; allow only greyscale/blur/rotate and grayscale/negate/blur; use cryptographically random filenames inside one configured storage root; remove input/output on every failure/abort; never expose paths or raw Sharp/FFmpeg errors. Missing Sharp/FFmpeg returns fixed `PROVIDER_UNAVAILABLE`.

- [ ] **Step 4: Run processing GREEN**

Expected: authentication, limits, signatures, allowlists, cleanup, timeouts, provider-unavailable and safe-error cases pass.

### Task 7: Close the ads-media cutover unit

**Files:** Modify manifest, corrections register, compatibility docs, coverage test; create `test/ads-media/cutover.spec.ts`.

**Interfaces:** Produces auditable 16/16 closure and zero Express-style ad/media implementation.

- [ ] **Step 1: Write cutover RED**

```ts
expect(routeSet).toEqual(expectedFifteenRoutes);
expect(coverage).toEqual({ assigned: 16, missing: 0, duplicate: 0, unresolved: 0 });
expect(source).not.toMatch(/data:\s*\{[^}]*\bstatus\s*:/); // Prisma writes use Status through the boundary
expect(source).not.toMatch(/writeFileSync|multer\(\{\s*dest|shell:\s*true/);
```

- [ ] **Step 2: Complete correction and client documentation**

Document canonical `Status`, atomic analytics, authenticated editing, upload/processor limits, client error/response compatibility, and the retained `/track-view` alias. Mark the manifest implemented at 16/16 without claiming programme completion.

- [ ] **Step 3: Run domain and foundation gates**

```powershell
.\node_modules\.bin\jest.cmd --runInBand --config test/ads-media/jest.config.json
.\node_modules\.bin\jest.cmd test/migration/ads-media-coverage.spec.ts --runInBand --config test/migration/jest.config.json
.\node_modules\.bin\jest.cmd --runInBand --config test/auth-users-security/jest.config.json
.\node_modules\.bin\eslint.cmd "{src,test,scripts}/**/*.{ts,mts}" --max-warnings=0
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
.\node_modules\.bin\prisma.cmd validate --config prisma.config.ts
.\node_modules\.bin\nest.cmd build -b swc
```

Expected: ads-media focused tests pass, 16/16 closure, preceding 60-capability domain remains green, full lint/type/schema/build pass; Prisma uses a dummy non-routable URL and executes no SQL.

## Self-Review

- Spec coverage: all 16 IDs map to one task and one owner; no provider or route is invented.
- Security coverage: ownership, admin/2FA, editing authentication, upload validation, processing timeout/cleanup, JSON parsing, transactional tracking, and safe errors are explicit.
- Type consistency: API `status` maps only at the Prisma boundary to `Status`; all JSON is parsed into explicit immutable contracts.
- Programme boundary: AdminJS/UI is untouched; whole-backend battle tests and independent review remain after all ten domains.
