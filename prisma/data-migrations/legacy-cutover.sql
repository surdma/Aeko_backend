-- Legacy cutover: bring an EXISTING Aeko database created by the Express
-- service up to the current schema, and backfill the relational social graph
-- from the JSON columns.
--
-- This is a DATA migration, not a Prisma schema migration, and it is outside
-- prisma/migrations on purpose. A fresh database gets the whole schema from
-- `0_init` and has nothing to backfill; only a database carrying legacy rows
-- needs this. Run it once, by hand, during the cutover:
--
--   psql "$DATABASE_URL" -f prisma/data-migrations/legacy-cutover.sql
--
-- Nothing is dropped and no existing column is rewritten. The JSON columns stay
-- authoritative for reads because the legacy Express service is still writing
-- them; the relational tables are dual-written by the NestJS service and are
-- only read from after the legacy service is retired.
--
-- `ads."Status"` is deliberately NOT renamed. The Prisma field is `status` via
-- `@map("Status")`, a client-side mapping only, so both services keep reading
-- and writing the same physical column while they run side by side.
--
-- Every statement is idempotent: DDL is guarded with IF NOT EXISTS and every
-- backfill INSERT ends in ON CONFLICT DO NOTHING, so a re-run or a batched run
-- cannot duplicate an edge.

-- ---------------------------------------------------------------------------
-- Schema catch-up. These ship in `0_init` for a fresh database.
-- ---------------------------------------------------------------------------

-- 1. Interests were a standalone table with no way to reach a user. This join
--    table is created empty; `users.interests` (JSON) remains authoritative
--    until the social-graph backfill runs.
CREATE TABLE IF NOT EXISTS "user_interests" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "interestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_interests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_interests_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_interests_interestId_fkey" FOREIGN KEY ("interestId")
    REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_interests_userId_interestId_key"
  ON "user_interests"("userId", "interestId");
CREATE INDEX IF NOT EXISTS "user_interests_interestId_idx"
  ON "user_interests"("interestId");

-- 2. `verification_settings.updatedBy` held a user id with no foreign key, so
--    deleting an admin left a dangling reference. Clear any id that no longer
--    resolves before adding the constraint, otherwise the ALTER fails.
UPDATE "verification_settings"
  SET "updatedBy" = NULL
  WHERE "updatedBy" IS NOT NULL
    AND "updatedBy" NOT IN (SELECT "id" FROM "users");

ALTER TABLE "verification_settings"
  DROP CONSTRAINT IF EXISTS "verification_settings_updatedBy_fkey";

ALTER TABLE "verification_settings"
  ADD CONSTRAINT "verification_settings_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Optional age, used by ad targeting. Null means "unknown", and the targeting
-- matcher skips the age check rather than excluding the viewer.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age" INTEGER;

CREATE TABLE IF NOT EXISTS "follows" (
  "id" TEXT NOT NULL,
  "followerId" TEXT NOT NULL,
  "followeeId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'accepted',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "follows_followeeId_fkey" FOREIGN KEY ("followeeId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "follows_followerId_followeeId_key"
  ON "follows"("followerId", "followeeId");
CREATE INDEX IF NOT EXISTS "follows_followeeId_state_idx"
  ON "follows"("followeeId", "state");
CREATE INDEX IF NOT EXISTS "follows_followerId_state_idx"
  ON "follows"("followerId", "state");

CREATE TABLE IF NOT EXISTS "blocks" (
  "id" TEXT NOT NULL,
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "blocks_blockerId_fkey" FOREIGN KEY ("blockerId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "blocks_blockedId_fkey" FOREIGN KEY ("blockedId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "blocks_blockerId_blockedId_key"
  ON "blocks"("blockerId", "blockedId");
CREATE INDEX IF NOT EXISTS "blocks_blockedId_idx" ON "blocks"("blockedId");

CREATE TABLE IF NOT EXISTS "post_likes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_likes_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_likes_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "post_likes_userId_postId_key"
  ON "post_likes"("userId", "postId");
CREATE INDEX IF NOT EXISTS "post_likes_postId_idx" ON "post_likes"("postId");

CREATE TABLE IF NOT EXISTS "comment_likes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comment_likes_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "comment_likes_commentId_fkey" FOREIGN KEY ("commentId")
    REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "comment_likes_userId_commentId_key"
  ON "comment_likes"("userId", "commentId");
CREATE INDEX IF NOT EXISTS "comment_likes_commentId_idx"
  ON "comment_likes"("commentId");

CREATE TABLE IF NOT EXISTS "not_interested" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "not_interested_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "not_interested_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "not_interested_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "not_interested_userId_postId_key"
  ON "not_interested"("userId", "postId");
CREATE INDEX IF NOT EXISTS "not_interested_postId_idx"
  ON "not_interested"("postId");

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Accepted follows.
--
-- `users.following` and `users.followers` are two denormalized halves of the
-- same relation and they disagree on some rows: A can list B in `following`
-- while B does not list A in `followers`, or the reverse. Reconciliation is by
-- UNION — an edge exists if either side recorded it.
--
-- Union is chosen deliberately over intersection. Both halves were written by
-- the same non-transactional read-modify-write that lost concurrent updates,
-- so a missing entry is far more likely to be a lost write than a deliberate
-- unfollow. Intersection would silently drop real follows; union at worst
-- resurrects an unfollow that half-failed, which the user can redo.
-- `edge_disagreements` below reports exactly how many rows this affected.
INSERT INTO "follows" ("id", "followerId", "followeeId", "state", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, edge."followerId", edge."followeeId",
       'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  -- A lists B in its `following`.
  SELECT u."id" AS "followerId", f.value #>> '{}' AS "followeeId"
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."following"::jsonb) = 'array'
         THEN u."following"::jsonb ELSE '[]'::jsonb END) AS f(value)
  WHERE jsonb_typeof(f.value) = 'string'
  UNION
  -- B lists A in its `followers`, which is the same edge seen from the other end.
  SELECT f.value #>> '{}' AS "followerId", u."id" AS "followeeId"
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."followers"::jsonb) = 'array'
         THEN u."followers"::jsonb ELSE '[]'::jsonb END) AS f(value)
  WHERE jsonb_typeof(f.value) = 'string'
) AS edge
-- Drop edges pointing at users that no longer exist, and self-follows.
JOIN "users" fr ON fr."id" = edge."followerId"
JOIN "users" fe ON fe."id" = edge."followeeId"
WHERE edge."followerId" <> edge."followeeId"
ON CONFLICT ("followerId", "followeeId") DO NOTHING;

-- Pending follow requests. `users.followRequests` holds objects
-- {user, requestedAt, status}; only `pending` is a live edge. An accepted
-- follow already inserted above wins, so this cannot downgrade a real follow.
INSERT INTO "follows" ("id", "followerId", "followeeId", "state", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, req."followerId", req."followeeId",
       'requested', req."requestedAt", CURRENT_TIMESTAMP
FROM (
  SELECT r.value ->> 'user' AS "followerId",
         u."id" AS "followeeId",
         COALESCE((r.value ->> 'requestedAt')::timestamp, CURRENT_TIMESTAMP)
           AS "requestedAt"
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."followRequests"::jsonb) = 'array'
         THEN u."followRequests"::jsonb ELSE '[]'::jsonb END) AS r(value)
  WHERE jsonb_typeof(r.value) = 'object'
    AND r.value ->> 'status' = 'pending'
    AND r.value ->> 'user' IS NOT NULL
) AS req
JOIN "users" fr ON fr."id" = req."followerId"
WHERE req."followerId" <> req."followeeId"
ON CONFLICT ("followerId", "followeeId") DO NOTHING;

-- Blocks. Entries accumulated several shapes over time: a bare string, or an
-- object keyed `user` or `userId`, where that key may itself hold an object
-- with an `id`. All four are read here; missing one silently unblocks someone.
INSERT INTO "blocks" ("id", "blockerId", "blockedId", "reason", "createdAt")
SELECT gen_random_uuid()::text, blk."blockerId", blk."blockedId",
       NULLIF(blk."reason", ''), blk."createdAt"
FROM (
  SELECT u."id" AS "blockerId",
         CASE
           WHEN jsonb_typeof(b.value) = 'string' THEN b.value #>> '{}'
           WHEN jsonb_typeof(b.value -> 'user') = 'string' THEN b.value ->> 'user'
           WHEN jsonb_typeof(b.value -> 'user') = 'object' THEN b.value #>> '{user,id}'
           WHEN jsonb_typeof(b.value -> 'userId') = 'string' THEN b.value ->> 'userId'
           WHEN jsonb_typeof(b.value -> 'userId') = 'object' THEN b.value #>> '{userId,id}'
           ELSE NULL
         END AS "blockedId",
         CASE WHEN jsonb_typeof(b.value) = 'object'
              THEN b.value ->> 'reason' ELSE NULL END AS "reason",
         COALESCE(
           CASE WHEN jsonb_typeof(b.value) = 'object'
                THEN (b.value ->> 'blockedAt')::timestamp ELSE NULL END,
           CURRENT_TIMESTAMP) AS "createdAt"
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."blockedUsers"::jsonb) = 'array'
         THEN u."blockedUsers"::jsonb ELSE '[]'::jsonb END) AS b(value)
) AS blk
JOIN "users" bd ON bd."id" = blk."blockedId"
WHERE blk."blockedId" IS NOT NULL
  AND blk."blockerId" <> blk."blockedId"
ON CONFLICT ("blockerId", "blockedId") DO NOTHING;

-- Post likes.
INSERT INTO "post_likes" ("id", "userId", "postId", "createdAt")
SELECT gen_random_uuid()::text, lk."userId", lk."postId", CURRENT_TIMESTAMP
FROM (
  SELECT l.value #>> '{}' AS "userId", p."id" AS "postId"
  FROM "posts" p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p."likes"::jsonb) = 'array'
         THEN p."likes"::jsonb ELSE '[]'::jsonb END) AS l(value)
  WHERE jsonb_typeof(l.value) = 'string'
) AS lk
JOIN "users" u ON u."id" = lk."userId"
ON CONFLICT ("userId", "postId") DO NOTHING;

-- Comment likes.
INSERT INTO "comment_likes" ("id", "userId", "commentId", "createdAt")
SELECT gen_random_uuid()::text, lk."userId", lk."commentId", CURRENT_TIMESTAMP
FROM (
  SELECT l.value #>> '{}' AS "userId", c."id" AS "commentId"
  FROM "comments" c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c."likes"::jsonb) = 'array'
         THEN c."likes"::jsonb ELSE '[]'::jsonb END) AS l(value)
  WHERE jsonb_typeof(l.value) = 'string'
) AS lk
JOIN "users" u ON u."id" = lk."userId"
ON CONFLICT ("userId", "commentId") DO NOTHING;

-- Not-interested. Stored as an object with a `posts` array, not a bare array.
INSERT INTO "not_interested" ("id", "userId", "postId", "createdAt")
SELECT gen_random_uuid()::text, ni."userId", ni."postId", CURRENT_TIMESTAMP
FROM (
  SELECT u."id" AS "userId", n.value #>> '{}' AS "postId"
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."notInterested"::jsonb -> 'posts') = 'array'
         THEN u."notInterested"::jsonb -> 'posts' ELSE '[]'::jsonb END) AS n(value)
  WHERE jsonb_typeof(n.value) = 'string'
) AS ni
JOIN "posts" p ON p."id" = ni."postId"
ON CONFLICT ("userId", "postId") DO NOTHING;

-- Interests, into the join table created empty by the previous migration.
INSERT INTO "user_interests" ("id", "userId", "interestId", "createdAt")
SELECT gen_random_uuid()::text, ui."userId", i."id", CURRENT_TIMESTAMP
FROM (
  SELECT u."id" AS "userId", n.value #>> '{}' AS "interest"
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."interests"::jsonb) = 'array'
         THEN u."interests"::jsonb ELSE '[]'::jsonb END) AS n(value)
  WHERE jsonb_typeof(n.value) = 'string'
) AS ui
-- Stored entries are interest names in some rows and ids in others.
JOIN "interests" i ON i."name" = ui."interest" OR i."id" = ui."interest"
ON CONFLICT ("userId", "interestId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Reconciliation report
-- ---------------------------------------------------------------------------
-- A record of what the union above actually resolved, so the disagreement
-- count is auditable after the fact instead of being lost with the JSON.
CREATE TABLE IF NOT EXISTS "social_graph_backfill_report" (
  "id" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "count" BIGINT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_graph_backfill_report_pkey" PRIMARY KEY ("id")
);

WITH forward AS (
  SELECT u."id" AS a, f.value #>> '{}' AS b
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."following"::jsonb) = 'array'
         THEN u."following"::jsonb ELSE '[]'::jsonb END) AS f(value)
  WHERE jsonb_typeof(f.value) = 'string'
),
reverse AS (
  SELECT f.value #>> '{}' AS a, u."id" AS b
  FROM "users" u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u."followers"::jsonb) = 'array'
         THEN u."followers"::jsonb ELSE '[]'::jsonb END) AS f(value)
  WHERE jsonb_typeof(f.value) = 'string'
)
INSERT INTO "social_graph_backfill_report" ("id", "metric", "count")
SELECT gen_random_uuid()::text, m.metric, m.count FROM (
  SELECT 'follow_edges_total' AS metric, count(*)::bigint AS count FROM "follows"
  UNION ALL
  SELECT 'follow_only_in_following',
         (SELECT count(*) FROM (SELECT a, b FROM forward EXCEPT SELECT a, b FROM reverse) x)
  UNION ALL
  SELECT 'follow_only_in_followers',
         (SELECT count(*) FROM (SELECT a, b FROM reverse EXCEPT SELECT a, b FROM forward) x)
  UNION ALL
  SELECT 'block_edges_total', (SELECT count(*) FROM "blocks")
  UNION ALL
  SELECT 'post_like_edges_total', (SELECT count(*) FROM "post_likes")
  UNION ALL
  SELECT 'comment_like_edges_total', (SELECT count(*) FROM "comment_likes")
  UNION ALL
  SELECT 'not_interested_edges_total', (SELECT count(*) FROM "not_interested")
  UNION ALL
  SELECT 'user_interest_edges_total', (SELECT count(*) FROM "user_interests")
) AS m;

-- ---------------------------------------------------------------------------
-- Community memberships paid for before the cutover.
-- ---------------------------------------------------------------------------
--
-- Legacy recorded a PAID community membership only in `communities.members`
-- (JSON), while every request path reads the relational `community_members`
-- table. A member who paid was therefore invisible to the community detail,
-- the leave check, the join check and the post guard.
--
-- The NestJS service dual-writes both halves from now on, and repairs a
-- JSON-only member the next time they pay. This backfill covers the ones who
-- never pay again: it reads the JSON array and inserts the missing relational
-- rows.
--
-- Only entries that name a real user are taken, and `ON CONFLICT DO NOTHING`
-- means an existing relational row always wins — the backfill never downgrades
-- a role or a status that the relational table already holds.

INSERT INTO "community_members" ("id", "communityId", "userId", "role", "status", "joinedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  m.value ->> 'user',
  COALESCE(NULLIF(m.value ->> 'role', ''), 'member'),
  COALESCE(NULLIF(m.value ->> 'status', ''), 'active'),
  CURRENT_TIMESTAMP
FROM "communities" c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c."members"::jsonb) = 'array'
       THEN c."members"::jsonb ELSE '[]'::jsonb END) AS m(value)
WHERE jsonb_typeof(m.value) = 'object'
  AND m.value ->> 'user' IS NOT NULL
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = m.value ->> 'user')
ON CONFLICT ("communityId", "userId") DO NOTHING;

-- `memberCount` is a stored counter that legacy moved by hand, so it has
-- drifted from the membership it is supposed to count. Reset it to the number
-- of active relational members now that those rows are complete.
UPDATE "communities" c
SET "memberCount" = (
  SELECT count(*)
  FROM "community_members" cm
  WHERE cm."communityId" = c."id" AND cm."status" = 'active'
);

INSERT INTO "social_graph_backfill_report" ("id", "metric", "count")
SELECT gen_random_uuid()::text, m.metric, m.count FROM (
  SELECT 'community_member_rows_total' AS metric,
         (SELECT count(*)::bigint FROM "community_members") AS count
  UNION ALL
  -- JSON entries naming a user who no longer exists; dropped, not migrated.
  SELECT 'community_member_json_orphans',
         (SELECT count(*)::bigint
          FROM "communities" c
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(c."members"::jsonb) = 'array'
                 THEN c."members"::jsonb ELSE '[]'::jsonb END) AS m(value)
          WHERE jsonb_typeof(m.value) = 'object'
            AND m.value ->> 'user' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "users" u WHERE u."id" = m.value ->> 'user'))
) AS m;
