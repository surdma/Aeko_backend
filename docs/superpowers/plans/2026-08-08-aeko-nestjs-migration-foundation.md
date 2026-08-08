# Aeko NestJS Migration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the strict, Aeko-specific NestJS foundation that every Express feature can be translated into without losing routes, data, authentication compatibility, errors, or operational behavior.

**Architecture:** The new repository remains a NestJS modular monolith. This plan first repairs the invalid scaffold, then creates a machine-checkable legacy inventory, restores the complete Prisma contract with additive Better Auth storage, installs typed cross-cutting infrastructure, and publishes exact domain ownership manifests for the remaining feature plans.

**Tech Stack:** Node.js 24 LTS, pnpm 10.33.2, NestJS 11 with the Express adapter and SWC, TypeScript 5.7 strict mode, Prisma 7/PostgreSQL, Better Auth 1.6, Zod, ESLint 9, Prettier 3, Jest 30, and Supertest 7.

## Global Constraints

- The behavioral reference is `C:\Users\olaitan\Dev\aeko\backend`; implementation occurs only in `C:\Users\olaitan\Dev\aeko\aeko_backend`.
- Preserve every mounted legacy route, Socket.IO event, job, provider flow, database effect, and stable response contract unless it is listed in the approved correction register.
- Use the Nest CLI to generate new Nest artifacts and append every command to `docs/nestjs-migration/nest-cli-ledger.md`.
- Application source contains no explicit or implicit `any`, unsafe double casts, blanket TypeScript suppressions, or unchecked non-null assertions.
- Keep legitimate nullable database semantics, but narrow every nullable value before use.
- Restore the full existing Prisma schema; do not deploy migrations or backfills to any database in this plan.
- Better Auth replaces handwritten authentication while compatibility controllers preserve legacy client contracts.
- AdminJS UI is not migrated; its persistence and export dependencies remain compatible and documented.
- Expensive endpoint-by-endpoint parity testing runs after feature translation is complete. Every task in this plan must still pass strict type checking, Prisma validation where applicable, and production build checks.
- Never claim the backend migration complete from compilation, directory presence, or inventory counts.

---

### Task 1: Repair And Lock The Project Toolchain

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tsconfig.json`
- Modify: `tsconfig.build.json`
- Modify: `eslint.config.mjs`
- Modify: `nest-cli.json`
- Modify: `.gitignore`
- Create: `.node-version`
- Create: `docs/nestjs-migration/nest-cli-ledger.md`
- Create: `test/toolchain.spec.ts`
- Create: `test/jest-tooling.json`

**Interfaces:**
- Consumes: the generated NestJS scaffold and installed Node.js 24 runtime
- Produces: `pnpm typecheck`, `pnpm lint`, `pnpm prisma:validate`, `pnpm build`, `pnpm verify:fast`, and an exact Nest CLI command ledger

- [ ] **Step 1: Write the failing toolchain assertions**

Create `test/toolchain.spec.ts` that reads `package.json`, `tsconfig.json`, and `eslint.config.mjs`. Assert:

```typescript
expect(manifest.packageManager).toBe('pnpm@10.33.2');
expect(manifest.engines.node).toBe('>=24 <25');
expect(manifest.scripts.postinstall).toBe('prisma generate');
expect(manifest.scripts.build).toBe('nest build -b swc');
expect(manifest.scripts.typecheck).toBe('tsc --noEmit --pretty false');
expect(manifest.scripts['verify:fast']).toBe(
  'pnpm format:check && pnpm lint && pnpm typecheck && pnpm prisma:validate && pnpm build',
);
expect(compilerOptions.strict).toBe(true);
expect(compilerOptions.noUncheckedIndexedAccess).toBe(true);
expect(compilerOptions.noImplicitOverride).toBe(true);
expect(compilerOptions.noImplicitReturns).toBe(true);
expect(eslintSource).toContain("'@typescript-eslint/no-explicit-any': 'error'");
expect(eslintSource).toContain("'@typescript-eslint/no-non-null-assertion': 'error'");
```

- [ ] **Step 2: Run the assertion and confirm the scaffold is RED**

Run: `pnpm exec jest --config ./test/jest-tooling.json test/toolchain.spec.ts --runInBand`

Expected: FAIL because the package manager/engine contracts are absent, scripts are malformed, strict compiler flags are incomplete, and unsafe lint rules are disabled or warnings.

- [ ] **Step 3: Repair the manifest and install only foundation dependencies**

Set these manifest values exactly:

```json
{
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": ">=24 <25", "pnpm": "10.33.2" },
  "scripts": {
    "postinstall": "prisma generate",
    "build": "nest build -b swc",
    "format": "prettier --write \"{src,test,scripts}/**/*.{ts,mts}\" \"docs/**/*.md\"",
    "format:check": "prettier --check \"{src,test,scripts}/**/*.{ts,mts}\" \"docs/**/*.md\"",
    "start": "nest start -b swc",
    "start:dev": "nest start --watch -b swc",
    "start:debug": "nest start --debug --watch -b swc",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"{src,test,scripts}/**/*.{ts,mts}\" --max-warnings=0",
    "typecheck": "tsc --noEmit --pretty false",
    "test": "jest --runInBand",
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
    "prisma:generate": "prisma generate",
    "prisma:validate": "prisma validate",
    "prisma:dev": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "verify:fast": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm prisma:validate && pnpm build"
  }
}
```

Install the foundation packages with pnpm: `@nestjs/config`, `@prisma/adapter-pg`, `pg`, `zod`, `helmet`, `cookie-parser`, `@thallesp/nestjs-better-auth`, `bcrypt`, and `jose`; install matching type packages and `@mrleebo/prisma-ast` as development dependencies where the library does not ship types. Keep Better Auth and Prisma on the versions already locked unless resolution proves an incompatibility.

- [ ] **Step 4: Enable strict compiler and lint gates**

Set `strict`, `strictNullChecks`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and `useUnknownInCatchVariables` to `true`. Change the unsafe ESLint warning/off rules to errors and add:

```javascript
'@typescript-eslint/no-explicit-any': 'error',
'@typescript-eslint/no-non-null-assertion': 'error',
'@typescript-eslint/no-unsafe-argument': 'error',
'@typescript-eslint/no-unsafe-assignment': 'error',
'@typescript-eslint/no-unsafe-call': 'error',
'@typescript-eslint/no-unsafe-member-access': 'error',
'@typescript-eslint/no-unsafe-return': 'error',
'@typescript-eslint/no-floating-promises': 'error',
'@typescript-eslint/only-throw-error': 'error',
```

- [ ] **Step 5: Record CLI ownership and remove local cache noise**

Create the ledger with columns `timestamp`, `command`, `artifact`, and `task`. Add `.corepack-cache/`, `dist/`, and coverage output to `.gitignore`. Write `24.18.1` to `.node-version`.

- [ ] **Step 6: Verify the repaired toolchain**

Run: `pnpm install --frozen-lockfile`

Run: `pnpm exec jest --config ./test/jest-tooling.json test/toolchain.spec.ts --runInBand`

Run: `pnpm typecheck`

Expected: the toolchain assertion passes. Type checking may still fail only on the known invalid Verilo-derived auth scaffold; capture exact failures in the task report for Task 4 rather than weakening flags.

- [ ] **Step 7: Commit the task**

```powershell
git add -- package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json eslint.config.mjs nest-cli.json .gitignore .node-version docs/nestjs-migration/nest-cli-ledger.md test/toolchain.spec.ts test/jest-tooling.json
git commit -m "build: lock strict NestJS migration toolchain"
```

### Task 2: Create The Machine-Checkable Legacy Capability Inventory

**Files:**
- Create: `scripts/inventory/legacy-source.ts`
- Create: `scripts/inventory/extract-rest.ts`
- Create: `scripts/inventory/extract-sockets.ts`
- Create: `scripts/inventory/extract-jobs.ts`
- Create: `scripts/inventory/extract-prisma.ts`
- Create: `scripts/inventory/build-inventory.ts`
- Create: `scripts/inventory/inventory.types.ts`
- Create: `docs/nestjs-migration/capability-inventory.json`
- Create: `docs/nestjs-migration/corrections.json`
- Create: `docs/nestjs-migration/inventory-report.md`
- Create: `test/migration/inventory.spec.ts`

**Interfaces:**
- Consumes: legacy `server.js`, mounted `routes/**/*.js`, `sockets/**/*.js`, `jobs/**/*.js`, and `prisma/schema.prisma`
- Produces: `CapabilityInventory` with stable identifiers for REST routes, socket events, jobs, models, providers, inactive code, and known corrections

- [ ] **Step 1: Define the inventory types**

Use these discriminated interfaces without `any`:

```typescript
type CapabilityKind = 'rest' | 'socket' | 'job' | 'model' | 'provider' | 'inactive';
type MigrationStatus = 'legacy' | 'planned' | 'implemented' | 'verified' | 'inactive';

interface SourceLocation {
  readonly file: string;
  readonly line: number;
}

interface CapabilityBase {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly source: SourceLocation;
  readonly owner: string;
  readonly risk: 'low' | 'medium' | 'high' | 'critical';
  readonly status: MigrationStatus;
}

interface RestCapability extends CapabilityBase {
  readonly kind: 'rest';
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly mountPath: string;
  readonly routePath: string;
  readonly effectivePath: string;
  readonly middleware: readonly string[];
}

interface Correction {
  readonly id: string;
  readonly capabilityIds: readonly string[];
  readonly category: 'security' | 'correctness' | 'runtime';
  readonly legacyEvidence: readonly SourceLocation[];
  readonly legacyBehavior: string;
  readonly replacementBehavior: string;
  readonly reason: string;
  readonly status: 'approved' | 'implemented' | 'verified';
}
```

Define corresponding `SocketCapability`, `JobCapability`, `ModelCapability`, `ProviderCapability`, and `InactiveCapability` types. Export `type Capability` as their union.

- [ ] **Step 2: Write failing inventory completeness tests**

Assert that inventory generation:

- resolves all 39 mounted router modules;
- records every effective route handler with a normalized method and effective path;
- detects duplicate or shadowed method/path pairs without silently removing them;
- records both Socket.IO namespaces and every literal inbound/outbound event;
- records all scheduled jobs and their cron expressions;
- records every Prisma model and enum;
- classifies the inactive files named in the approved design;
- gives every item one feature owner and a unique stable ID;
- starts every active item at `legacy` and every inactive item at `inactive`;
- seeds every approved correction from the design document.

- [ ] **Step 3: Verify the inventory test fails**

Run: `pnpm exec jest test/migration/inventory.spec.ts --runInBand`

Expected: FAIL because no inventory generator or inventory exists.

- [ ] **Step 4: Implement syntax-aware extraction**

Parse JavaScript with the installed TypeScript compiler API in `allowJs` mode and parse Prisma with `@mrleebo/prisma-ast`, without importing or executing the legacy application. Resolve route mounts from `server.js`, preserve declaration order, and compose mount plus router paths. When a path or event cannot be resolved statically, emit an `unresolved` diagnostic and fail the completeness test; never guess.

The builder must sort by kind, source file, source line, method, and effective path so identical input produces byte-stable JSON. The Markdown report summarizes counts, unresolved items, duplicate/shadowed routes, owners, risk, and inactive items.

- [ ] **Step 5: Generate and inspect the inventory**

Run: `pnpm exec ts-node scripts/inventory/build-inventory.ts --legacy-root C:\Users\olaitan\Dev\aeko\backend`

Run: `pnpm exec jest test/migration/inventory.spec.ts --runInBand`

Expected: PASS with zero unresolved mounted capabilities. Do not hard-code the approximate 284-handler count as truth; the extractor's reviewed output becomes the exact baseline.

- [ ] **Step 6: Commit the task**

```powershell
git add -- scripts/inventory docs/nestjs-migration/capability-inventory.json docs/nestjs-migration/corrections.json docs/nestjs-migration/inventory-report.md test/migration/inventory.spec.ts
git commit -m "docs: inventory legacy Aeko capabilities"
```

### Task 3: Restore The Complete Prisma Contract And Add Better Auth Storage

**Files:**
- Replace: `prisma/schema.prisma`
- Regenerate: `prisma/generated/**`
- Create: `prisma/migrations/20260808_add_better_auth_compatibility/migration.sql`
- Create: `scripts/auth/audit-better-auth-readiness.ts`
- Create: `scripts/auth/backfill-better-auth.ts`
- Create: `docs/nestjs-migration/database-compatibility.md`
- Create: `test/migration/prisma-schema.spec.ts`
- Create: `test/auth/better-auth-backfill.spec.ts`

**Interfaces:**
- Consumes: the complete legacy Prisma schema and existing PostgreSQL table/column mappings
- Produces: Prisma 7 generated client, legacy `User` compatibility, additive `Account`, `Session`, and `Verification` storage, and dry-run-only auth audit/backfill commands

- [ ] **Step 1: Write failing schema preservation tests**

Parse the legacy and target Prisma schemas and assert every legacy model, enum, mapped table, field name, scalar/list shape, relation, index, unique constraint, default, and mapped column is present unchanged in the target unless listed in `corrections.json`. Add explicit assertions that target `User` remains mapped to `users`, retains its existing required `password`, and gains Better Auth fields and relations without a second user table.

- [ ] **Step 2: Write failing backfill tests**

Against an in-memory repository port, cover:

- existing email/password users;
- existing Google OAuth users;
- already-backfilled users;
- malformed or duplicate legacy OAuth identifiers;
- batch continuation and checkpointing;
- dry-run producing counts without writes;
- reruns producing no duplicate accounts;
- no plaintext password or token logging.

- [ ] **Step 3: Verify RED**

Run: `pnpm exec jest test/migration/prisma-schema.spec.ts test/auth/better-auth-backfill.spec.ts --runInBand`

Expected: FAIL because the target currently contains only four Better Auth models and no legacy schema/backfill.

- [ ] **Step 4: Restore the legacy schema for Prisma 7**

Copy the complete legacy schema as the semantic base. Change only the Prisma 7 client generator and datasource mechanics:

```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated"
}

datasource db {
  provider = "postgresql"
}
```

Do not rename or reformat mapped database identifiers as a migration shortcut.

- [ ] **Step 5: Add Better Auth compatibility fields and models**

Extend the existing `User` model with:

```prisma
emailVerified Boolean        @default(false) @map("better_auth_email_verified")
image         String?        @map("better_auth_image")
sessions      AuthSession[]
accounts      AuthAccount[]
```

Add additive models mapped to isolated table names:

```prisma
model AuthSession {
  id        String   @id @default(uuid())
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("better_auth_sessions")
}

model AuthAccount {
  id                    String    @id @default(uuid())
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@unique([providerId, accountId])
  @@index([userId])
  @@map("better_auth_accounts")
}

model AuthVerification {
  id         String   @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("better_auth_verifications")
}
```

Configure Better Auth model names to match these Prisma model names; adapter configuration uses Prisma model names, not table names.

- [ ] **Step 6: Create additive migration and dry-run tooling**

The SQL migration may only add the two `users` columns and the three Better Auth tables/indexes/foreign keys. It must not drop, rename, truncate, or rewrite a legacy table. The audit script reports candidate counts and conflicts. The backfill requires `--dry-run` by default and refuses writes unless both `--apply` and an explicit non-production confirmation variable are supplied.

- [ ] **Step 7: Validate without deploying**

Run: `pnpm prisma:validate`

Run: `pnpm prisma:generate`

Run: `pnpm exec jest test/migration/prisma-schema.spec.ts test/auth/better-auth-backfill.spec.ts --runInBand`

Expected: PASS. Do not run `prisma migrate deploy`, `prisma migrate dev`, or the backfill against a real database in this task.

- [ ] **Step 8: Commit the task**

```powershell
git add -- prisma scripts/auth docs/nestjs-migration/database-compatibility.md test/migration/prisma-schema.spec.ts test/auth/better-auth-backfill.spec.ts
git commit -m "feat: restore Aeko schema with Better Auth storage"
```

### Task 4: Build The Strict Nest Application Foundation

**Files:**
- Replace: `src/main.ts`
- Replace: `src/app.module.ts`
- Create via Nest CLI: `src/configuration/**`
- Create via Nest CLI: `src/database/**`
- Create via Nest CLI: `src/common/errors/**`
- Create via Nest CLI: `src/common/http/**`
- Repair: `src/health/**`
- Create: `test/foundation/application.spec.ts`
- Create: `test/foundation/errors.spec.ts`

**Interfaces:**
- Produces: `createApplication(options: ApplicationOptions): Promise<INestApplication>`, `PrismaService`, `AppConfig`, `DomainError`, `GlobalExceptionFilter`, `RequestContext`, `/health/live`, and `/health/ready`

- [ ] **Step 1: Generate the foundation artifacts using Nest CLI**

Run from the target repository and append each command to the CLI ledger:

```powershell
pnpm exec nest generate module configuration --no-spec
pnpm exec nest generate service configuration/configuration --no-spec
pnpm exec nest generate module database --no-spec
pnpm exec nest generate service database/prisma --no-spec
pnpm exec nest generate filter common/errors/global-exception --no-spec
pnpm exec nest generate middleware common/http/request-context --no-spec
pnpm exec nest generate interceptor common/http/response-compatibility --no-spec
```

- [ ] **Step 2: Write focused foundation tests**

Cover invalid environment rejection, awaited Prisma connection, graceful disconnection, liveness, readiness success/failure, request ID acceptance/generation, malformed JSON, `DomainError` mapping, unknown exception sanitization, and no raw exception/secret leakage.

- [ ] **Step 3: Implement validated configuration**

Define `AppConfig` with Zod-parsed values for `NODE_ENV`, `PORT`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, trusted origins, proxy hops, and optional provider credentials. Export only the parsed immutable object; do not read `process.env` throughout feature code.

- [ ] **Step 4: Implement Prisma lifecycle for Prisma 7**

Construct `PrismaClient` with `PrismaPg` and the validated connection string. `onModuleInit` awaits `$connect`; `onModuleDestroy` awaits `$disconnect`. Export one `PrismaService` from `DatabaseModule` and enable Nest shutdown hooks.

- [ ] **Step 5: Implement typed errors and global capture**

Define:

```typescript
type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

interface PublicErrorBody {
  readonly success: false;
  readonly message: string;
  readonly code: DomainErrorCode;
  readonly requestId: string;
  readonly details?: Readonly<Record<string, string | readonly string[]>>;
}
```

`GlobalExceptionFilter` handles `unknown`, preserves typed HTTP/domain errors, maps Prisma/provider failures through explicit guards, logs structured sanitized metadata, and emits no raw stack/message to clients.

- [ ] **Step 6: Implement application bootstrap**

`createApplication` sets body limits compatible with the legacy 50 MB contract, cookie parsing, Helmet, CORS from validated origins, trusted proxy configuration, request context, global filter, and shutdown hooks. Raw webhook body capture must remain possible for the later payment module.

- [ ] **Step 7: Verify the foundation**

Run: `pnpm exec jest test/foundation/application.spec.ts test/foundation/errors.spec.ts --runInBand`

Run: `pnpm verify:fast`

Expected: PASS with no warnings, `any`, non-null assertions, foreign Verilo imports, or unresolved providers.

- [ ] **Step 8: Commit the task**

```powershell
git add -- src test/foundation docs/nestjs-migration/nest-cli-ledger.md
git commit -m "feat: establish strict NestJS application foundation"
```

### Task 5: Install Aeko Better Auth And Typed Authorization Boundaries

**Files:**
- Replace: `src/auth/**`
- Replace: `src/lib/auth/**`
- Create via Nest CLI: `src/auth/guards/**`
- Create via Nest CLI: `src/auth/decorators/**`
- Create: `src/auth/auth.types.ts`
- Create: `src/auth/auth.config.ts`
- Create: `src/auth/legacy-auth-contracts.ts`
- Create: `docs/nestjs-migration/auth-compatibility.md`
- Create: `test/auth/auth-configuration.spec.ts`
- Create: `test/auth/authorization.spec.ts`

**Interfaces:**
- Produces: Aeko Better Auth instance, `AuthenticatedPrincipal`, anonymous/session guards, ownership/role/2FA policies, and typed legacy auth contract definitions
- Does not yet produce: the complete legacy auth controller behavior, which belongs to the auth/users/security domain plan

- [ ] **Step 1: Characterize legacy auth contracts**

Record all `/api/auth` and overlapping `/api/users` endpoints, current status/envelopes, seven-day bearer/cookie behavior, bcrypt cost, partial 2FA claims, banned-user handling, verification JSON behavior, Google web/mobile flows, and error defects. Mark raw errors, verification-code disclosure, OAuth deep-link token exposure, and missing ownership/enum defenses in `corrections.json` where evidenced.

- [ ] **Step 2: Generate Aeko auth boundaries using Nest CLI**

Run and ledger:

```powershell
pnpm exec nest generate module auth --no-spec --flat
pnpm exec nest generate guard auth/guards/session --no-spec
pnpm exec nest generate guard auth/guards/optional-session --no-spec
pnpm exec nest generate guard auth/guards/role --no-spec
pnpm exec nest generate guard auth/guards/ownership --no-spec
pnpm exec nest generate guard auth/guards/two-factor --no-spec
pnpm exec nest generate decorator auth/decorators/current-user --no-spec
```

If an artifact already exists, move or replace it only after preserving any Aeko-specific behavior; foreign Verilo content is not preserved as functionality.

- [ ] **Step 3: Write focused configuration and policy tests**

Assert the auth instance uses Aeko, `/api/auth`, the Prisma PostgreSQL adapter, email/password minimum length 6 for legacy compatibility, Google only when configured, bearer sessions, secure production cookies, trusted origins, and `AuthUser`/`AuthSession`/`AuthAccount` model names. Test anonymous, authenticated, banned, role, ownership, partial-2FA, and full-2FA policy decisions.

- [ ] **Step 4: Configure Better Auth from Aeko evidence**

Use the existing `User` model and additive auth models. Configure email/password, Google OAuth, bearer support, and two-factor support required by legacy behavior. Use Aeko email/provider ports rather than importing application-specific concrete services into the auth instance. Keep compatibility response translation outside Better Auth configuration.

- [ ] **Step 5: Define the principal without Prisma leakage**

```typescript
interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly banned: boolean;
  readonly twoFactorEnabled: boolean;
  readonly twoFactorSatisfied: boolean;
  readonly sessionId: string;
}
```

Guards attach only this immutable principal. They do not delete fields from a Prisma object or mutate request user records.

- [ ] **Step 6: Define compatibility contracts**

Create Zod schemas and response types for every legacy auth endpoint without yet implementing all handlers. The later auth domain plan must consume these exported contracts verbatim.

- [ ] **Step 7: Verify auth foundation**

Run: `pnpm exec jest test/auth/auth-configuration.spec.ts test/auth/authorization.spec.ts --runInBand`

Run: `pnpm verify:fast`

Expected: PASS with no Verilo imports or application name, no explicit `any`, and no database migration execution.

- [ ] **Step 8: Commit the task**

```powershell
git add -- src/auth src/lib/auth test/auth docs/nestjs-migration/auth-compatibility.md docs/nestjs-migration/corrections.json docs/nestjs-migration/nest-cli-ledger.md
git commit -m "feat: add Aeko Better Auth foundation"
```

### Task 6: Publish Dependency-Ordered Domain Migration Manifests

**Files:**
- Create: `docs/nestjs-migration/program.md`
- Create: `docs/nestjs-migration/domains/auth-users-security.json`
- Create: `docs/nestjs-migration/domains/content-social.json`
- Create: `docs/nestjs-migration/domains/debates-challenges-spaces.json`
- Create: `docs/nestjs-migration/domains/communities.json`
- Create: `docs/nestjs-migration/domains/chat-realtime.json`
- Create: `docs/nestjs-migration/domains/livestream.json`
- Create: `docs/nestjs-migration/domains/ads-media.json`
- Create: `docs/nestjs-migration/domains/payments-subscriptions.json`
- Create: `docs/nestjs-migration/domains/chain.json`
- Create: `docs/nestjs-migration/domains/admin-support-jobs.json`
- Create: `test/migration/program-coverage.spec.ts`

**Interfaces:**
- Consumes: the reviewed capability inventory, corrections register, Prisma types, Nest foundation, and auth interfaces
- Produces: exactly one domain owner and implementation order for every active capability

- [ ] **Step 1: Define the manifest schema**

Each domain manifest contains:

```typescript
interface DomainManifest {
  readonly id: string;
  readonly order: number;
  readonly capabilityIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly nestModules: readonly string[];
  readonly providerPorts: readonly string[];
  readonly corrections: readonly string[];
  readonly cutoverUnit: readonly string[];
  readonly risk: 'low' | 'medium' | 'high' | 'critical';
  readonly specialistReview: readonly ('backend' | 'security' | 'payments' | 'blockchain' | 'realtime')[];
}
```

- [ ] **Step 2: Write failing coverage tests**

Fail when an active inventory item is absent, duplicated, assigned before a dependency, assigned to an unknown Nest module, or placed in a cutover unit that can create dual writes. Fail when payment, webhook, or chain capabilities lack their required specialist review.

- [ ] **Step 3: Create all ten manifests**

Assign every active capability exactly once. Use dependency order: foundation/auth first; user and social state before content; content before communities/realtime; payments before paid-community/coins; wallets before NFT/marketplace/post-chain operations; jobs only after their services exist.

- [ ] **Step 4: Generate the programme report**

List exact counts by domain/kind/risk, dependencies, cutover units, correction ownership, and the next plan file to author. The first domain implementation plan is `docs/superpowers/plans/2026-08-08-auth-users-security-migration.md`.

- [ ] **Step 5: Verify coverage and fast quality gates**

Run: `pnpm exec jest test/migration/program-coverage.spec.ts --runInBand`

Run: `pnpm verify:fast`

Expected: PASS with zero unknown, uncovered, or multiply owned active capabilities.

- [ ] **Step 6: Independent task review**

The reviewer checks inventory completeness, schema preservation, no migration deployment, Aeko-only Better Auth configuration, strict type gates, correction ownership, and programme coverage. Compilation alone is not a Pass.

- [ ] **Step 7: Commit the task**

```powershell
git add -- docs/nestjs-migration/program.md docs/nestjs-migration/domains test/migration/program-coverage.spec.ts
git commit -m "plan: define complete Aeko migration programme"
```

## Foundation Completion Gate

This plan is complete only when all six tasks are committed and independently reviewed, the inventory has zero unresolved active capabilities, the complete legacy Prisma schema is preserved, Better Auth is Aeko-specific, `pnpm verify:fast` passes, no database migration/backfill has been applied, and every capability is assigned to one dependency-ordered domain manifest.

Completion of this plan means the migration foundation is ready. It does not mean the Express backend has been fully migrated.
