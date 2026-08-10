-- Relational integrity pass. Additive only: no column is dropped, no existing
-- column changes type, and no request or response shape changes.
--
-- The `ads."Status"` column is deliberately NOT renamed. The Prisma field is
-- now `status` via `@map("Status")`, which is a client-side mapping only, so
-- the legacy Express service keeps reading and writing the same column while
-- both services run.

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
