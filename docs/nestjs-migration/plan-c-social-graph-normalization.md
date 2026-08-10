# Plan C — Social graph normalization and enum conversion

Status: **not started**. Written 2026-08-10, after passes A and B landed.

This plan covers every schema flaw that could not be fixed without touching
existing rows. Passes A and B deliberately stopped at the point where a change
would require reading or rewriting production data; everything below that line
is here.

## Why this is separate

A and B were safe because nothing they did depended on what is already stored:
A changed only TypeScript, and B added two empty structures plus a client-side
column mapping. Every item below either rewrites existing rows or adds a
constraint that existing rows can violate. Each one can fail a deploy against
real data, and each one changes read paths that the legacy Express service is
still serving. They need staging runs and a dual-write window, not a refactor.

## Scope

### C1 — Social graph tables

Seven JSON columns currently hold relationships. They cannot be indexed,
joined, filtered in SQL, or written concurrently without a `Serializable`
transaction and retry.

| Current                | Replacement                          | Cardinality |
| ---------------------- | ------------------------------------ | ----------- |
| `users.followers`      | `Follow(followerId, followeeId)`     | many-many   |
| `users.following`      | same `Follow` table, other direction | many-many   |
| `users.followRequests` | `Follow.state = 'requested'`         | many-many   |
| `users.blockedUsers`   | `Block(blockerId, blockedId)`        | many-many   |
| `users.notInterested`  | `NotInterested(userId, postId)`      | many-many   |
| `posts.likes`          | `PostLike(userId, postId)`           | many-many   |
| `comments.likes`       | `CommentLike(userId, commentId)`     | many-many   |

`users.interests` is already covered: pass B created the empty
`user_interests` table, so C1 only has to backfill it.

Notes that matter for the backfill:

- `users.followers` and `users.following` are two denormalized halves of one
  relation and **will disagree** on some rows. Decide the reconciliation rule
  before writing the backfill — union is the safe default, but it needs to be
  a stated decision, not an accident.
- `blockedUsers` has at least three historical entry shapes: a bare string, and
  objects keyed `user`, `userId`, or `id`. `blockedIds()` in
  `src/posts/post-prisma.client.ts` is the existing reader and is the reference
  for what the backfill has to accept. Missing a shape silently unblocks
  someone, so this needs a reconciliation report, not just a migration.
- `notInterested` is an object with a `posts` array, not a bare array.

### C2 — Enum conversion

Intended for pass B, moved here. Converting `status String` to a Postgres enum
is `ALTER TABLE ... TYPE ... USING`, which **hard-fails** if any stored value
falls outside the enum. The nest branch's `DATABASE_URL` points at an empty
database with none of the legacy tables, so the real value distribution could
not be checked, and shipping an unvalidated enum migration is how you take a
deploy down.

Candidate columns, with the closed set the application already enforces:

| Column                | Enforced by                              |
| --------------------- | ---------------------------------------- |
| `ads.Status`          | `AD_STATUSES` (`src/ads/ad.contract.ts`) |
| `posts.type`          | `POST_TYPES`                             |
| `status.type`         | `STATUS_TYPES`                           |
| `reports.entityType`  | `REPORT_ENTITY_TYPES`                    |
| `posts.status`        | no contract yet — define one first       |
| `reports.status`      | no contract yet — free text today        |
| `transactions.status` | no contract yet                          |
| `support_tickets.*`   | no contract yet                          |

Pre-flight, run against production before writing any enum migration:

```bash
psql "$DATABASE_URL" -c 'SELECT "Status", count(*) FROM ads GROUP BY 1 ORDER BY 2 DESC'
```

Repeat per column. Any value outside the contract's list must get an explicit
mapping decision before the enum is created — never a silent coercion to the
default.

### C3 — Retire the JSON columns

Only after C1 has been backfilled, reconciled, and dual-writing for long enough
that the legacy service is off them. Dropping these is the step that actually
breaks the legacy Express service, so it is last and it is its own deploy.

## Sequencing

Each step is a separate deploy. Do not collapse them.

1. **Add tables, empty.** New relational tables ship with no reads and no
   writes. Zero risk, fully reversible.
2. **Dual-write.** Every mutation writes both the JSON column and the new
   table. JSON stays authoritative for reads. Diverging writes now show up in
   monitoring rather than in a backfill six weeks later.
3. **Backfill.** Batched, resumable, idempotent — keyed on
   `(followerId, followeeId)` etc. so a rerun is a no-op. Emit a reconciliation
   report: rows migrated, shapes rejected, `followers`/`following`
   disagreements. Review the report before step 4.
4. **Read cutover, behind a flag.** Move reads to the relational tables one
   endpoint at a time. Keep dual-write on. This is where the feed queries stop
   scanning JSON.
5. **Verify.** Compare relational and JSON reads in production for a fixed
   window; the counts must agree before continuing.
6. **Stop dual-writing**, then **drop the JSON columns** (C3). Separate
   deploys.

C2 is independent of C1 and can run in parallel, after its pre-flight.

## Compatibility constraint

The legacy Express service at `../backend` reads and writes these same columns
throughout steps 1–5. That is what forces dual-write, and it is why C3 cannot
happen until legacy is off. No API request or response shape changes anywhere
in this plan — the wire contracts in `*.contract.ts` are the boundary and stay
exactly as they are.

## What this fixes

- The feed's follow, block, and not-interested filters become indexed joins
  instead of JSON array scans over every candidate row.
- `runSerializable` + P2034 retry disappears from the like and bookmark paths;
  a like becomes an insert with a unique constraint, so concurrent likes stop
  contending.
- `readFollowerCount` in `src/profiles/profile-prisma.client.ts` and
  `blockedIds` in `src/posts/post-prisma.client.ts` — the last two runtime
  shape checks left after pass A — both go away, because Prisma can type the
  result.

## Known issues found during A/B, not yet addressed

- `src/ads/ad-prisma.client.ts` `findViewer` selected `users.age`, a column
  that does not exist. Under the old reflection boundary this made every call
  fail Prisma validation. Pass A hardcodes `age: null`, which is what the
  targeting matcher already handles, but **age targeting is therefore inert**.
  Either add an `age` or `dateOfBirth` column, or remove age from the ad
  targeting contract. Needs a product decision.
- `AdWriteData` and `PostWriteData` are still index-signature types assembled
  from contracts rather than Prisma input types. The update path now
  type-checks against Prisma; `create` still needs a cast because required
  fields cannot be proven from an index signature. Typing these properly means
  reshaping how the services build write payloads.
