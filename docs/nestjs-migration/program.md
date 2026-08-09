# Aeko NestJS migration programme

## Authority and scope

This programme consumes the reviewed legacy capability inventory, approved
corrections register, preserved Prisma schema, strict Nest foundation, and
native Better Auth cutover contract. It assigns every active inventory ID to
one of exactly ten dependency-ordered migration domains. It does not deploy a
database migration, backfill data, migrate an endpoint, or remove Express.

The manifests implement this schema:

```ts
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
  readonly specialistReview: readonly (
    'backend' | 'security' | 'payments' | 'blockchain' | 'realtime'
  )[];
}
```

All JSON files use sorted capability IDs, sorted provider ports, sorted
correction IDs, two-space indentation, and a trailing newline. Re-running the
artifact-driven generator produced byte-identical SHA-256 results for all ten
files.

## Exact coverage

- Inventory capabilities: 577
- Active capabilities assigned exactly once: 575
- Inactive capabilities excluded from active ownership: 2
- Unknown active IDs: 0
- Uncovered active IDs: 0
- Multiply owned active IDs: 0
- Active kinds: REST 287, socket 208, provider 46, model 31, job 3
- Active capability risks: critical 54, high 277, medium 142, low 102
- Manifest risks: critical 3, high 7, medium 0, low 0

| Order | Domain                      | Total | Kinds                                    | Capability risks            | Manifest risk |
| ----: | --------------------------- | ----: | ---------------------------------------- | --------------------------- | ------------- |
|     1 | `auth-users-security`       |    60 | model 3, provider 3, REST 54             | high 39, low 21             | high          |
|     2 | `ads-media`                 |    16 | model 1, REST 15                         | high 1, low 15              | high          |
|     3 | `content-social`            |    52 | model 6, REST 46                         | high 6, medium 27, low 19   | high          |
|     4 | `debates-challenges-spaces` |    16 | model 3, REST 13                         | high 3, low 13              | high          |
|     5 | `payments-subscriptions`    |    30 | model 3, provider 8, REST 19             | critical 13, high 17        | critical      |
|     6 | `communities`               |    23 | model 4, REST 19                         | high 8, medium 8, low 7     | high          |
|     7 | `chat-realtime`             |   102 | model 6, provider 4, REST 34, socket 58  | high 10, medium 82, low 10  | high          |
|     8 | `livestream`                |   178 | model 2, provider 1, REST 25, socket 150 | high 153, medium 25         | high          |
|     9 | `chain`                     |    45 | provider 22, REST 23                     | critical 40, high 3, low 2  | critical      |
|    10 | `admin-support-jobs`        |    53 | job 3, model 3, provider 8, REST 39      | critical 1, high 37, low 15 | critical      |

The 31 inventory models originally owned by `database-foundation` remain one
canonical Prisma schema but move to their only feature migration owner:

- `auth-users-security`: `SecurityEvent`, `User`, `VerificationSettings`
- `ads-media`: `Ad`
- `content-social`: `Bookmark`, `Comment`, `Notification`, `Post`, `Report`, `Status`
- `debates-challenges-spaces`: `Challenge`, `Debate`, `Space`
- `payments-subscriptions`: `CoinTransaction`, `SubscriptionPlan`, `Transaction`
- `communities`: `Community`, `CommunityFollower`, `CommunityMember`, `Interest`
- `chat-realtime`: `BotConversation`, `BotSettings`, `Chat`, `ChatMember`, `EnhancedMessage`, `Message`
- `livestream`: `LiveStream`, `LiveStreamGift`
- `admin-support-jobs`: `SupportMessage`, `SupportTicket`, `WaitlistEntry`

No chain-only Prisma model exists in the reviewed inventory, so the chain
manifest does not invent one.

## Dependency order and cutover

| Domain                      | Depends on                                                                                    | Ordered bounded Nest capabilities                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `auth-users-security`       | none                                                                                          | auth, users, profiles, security                                        |
| `ads-media`                 | `auth-users-security`                                                                         | ads, photo-editing, video-editing, uploads, media, IPFS                |
| `content-social`            | `auth-users-security`, `ads-media`                                                            | posts, comments, status, explore, notifications, reports               |
| `debates-challenges-spaces` | `auth-users-security`, `content-social`                                                       | debates, challenges, spaces                                            |
| `payments-subscriptions`    | `auth-users-security`                                                                         | payments, subscription-plans, subscriptions, webhooks, coins           |
| `communities`               | `auth-users-security`, `content-social`, `payments-subscriptions`                             | interests, communities, community-profiles, community-payments         |
| `chat-realtime`             | `auth-users-security`, `content-social`, `communities`                                        | chat, enhanced-chat, bot, enhanced-bot, video-calls, root-realtime     |
| `livestream`                | `auth-users-security`, `content-social`, `chat-realtime`                                      | livestream                                                             |
| `chain`                     | `auth-users-security`, `ads-media`, `content-social`, `payments-subscriptions`, `communities` | wallets, NFTs, marketplace, rewards, staking, post-chain-operations    |
| `admin-support-jobs`        | all preceding domains                                                                         | admin-api, support, waitlist, exports, jobs, health, API documentation |

The order makes identity and user state available first; media exists before
content; content exists before communities and realtime; payments exist before
community payments and coins; and wallets precede NFTs, marketplace, and
post-chain operations. The final domain depends on all feature services so its
exports and three scheduled jobs cannot be translated ahead of their effects.

Each manifest's `cutoverUnit` is exactly its complete sorted `capabilityIds`
set. A capability cannot be enabled through a second domain manifest, so a
cutover has one target writer. Duplicate and shadowed legacy declarations keep
their distinct inventory IDs in that single unit even when an approved
correction later consolidates the effective behavior. Route-level production
ownership changes only after the domain plan proves parity and atomically
switches the complete unit; mixed Express/Nest writes are prohibited.

## Native authentication and administrative boundary

`auth-users-security` owns every legacy `/api/auth/**` inventory ID and
`correction:native-better-auth-cutover`. Those declarations are removal inputs:
native Better Auth exclusively owns `/api/auth/**`, and no compatibility
controller, legacy JWT/bcrypt flow, Passport callback, token cookie, reset
store, or verification-code store may be recreated. Application profile data
moves to the users/profiles slice, and clients must switch to Better Auth's
native endpoints and contracts before Express auth is removed.

The `admin-support-jobs` manifest covers the reviewed administrative API,
persistence, exports, health, documentation, and jobs. AdminJS UI remains
unimplemented and is not promoted into an invented Nest UI capability.

## Correction ownership

The committed corrections register contains 17 approved corrections after the
native Better Auth correction was added. Each correction has one programme
owner; broadly seeded correction evidence may reference capabilities in more
than one manifest without changing those capabilities' single owners.

| Domain                   | Corrections                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-users-security`    | `correction:database-readiness`, `correction:native-better-auth-cutover`                                                                                                   |
| `content-social`         | `correction:raw-error-disclosure`, `correction:shadowed-post-routes`                                                                                                       |
| `payments-subscriptions` | `correction:prisma-imports`, `correction:subscription-expiry-email`, `correction:webhook-verification`                                                                     |
| `communities`            | `correction:community-profile-ownership-drift`, `correction:nonexistent-prisma-models`                                                                                     |
| `chain`                  | `correction:explorer-history-method`, `correction:post-chain-ownership`, `correction:wallet-ownership-proof`                                                               |
| `admin-support-jobs`     | `correction:admin-cookie-secret`, `correction:blocking-privacy-order`, `correction:environment-load-order`, `correction:health-route-drift`, `correction:security-headers` |

## Inactive and deferred work

`inactive:routes/adminAuth.js` and
`inactive:routes/postTransferRoutes.js` remain documented inactive inventory
items. They are excluded from active ownership and are not promoted into Nest
features. The active post-chain capability IDs from the mounted post routes
remain distinct and belong to `chain`.

Payment and webhook work requires payments and security review; chain work
requires blockchain and security review; Socket.IO domains require realtime
review; every domain requires backend review. The final admin/jobs domain asks
all specialists to review its cross-domain operational effects.

Final endpoint battle testing, deployment review, migration/backfill execution,
traffic cutover, Express removal, and full independent programme review remain
deferred by instruction. The focused programme coverage suite and strict static
quality gates are required now; compilation alone is not a pass.

## Next plan

The first domain implementation plan to author is
`docs/superpowers/plans/2026-08-08-auth-users-security-migration.md`.
