import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs the real community-membership backfill against a real Postgres (PGlite,
 * in memory) seeded with the shapes `communities.members` actually holds. A
 * backfill that reconciles two disagreeing stores cannot be reviewed by
 * reading it — it has to be run.
 */

const workspace = process.cwd();

const cutoverSql = (): string =>
  readFileSync(
    resolve(workspace, 'prisma', 'data-migrations', 'legacy-cutover.sql'),
    'utf8',
  );

/** Only the fragment of the cutover that touches community membership. */
const membershipSection = (): string => {
  const sql = cutoverSql();
  const marker = '-- Community memberships paid for before the cutover.';
  const start = sql.indexOf(marker);
  if (start < 0) {
    throw new Error(
      'community membership backfill is missing from the cutover',
    );
  }
  return sql.slice(start);
};

const BASE_DDL = `
CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL
);
CREATE TABLE "communities" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "members" JSONB
);
CREATE TABLE "community_members" (
  "id" TEXT PRIMARY KEY,
  "communityId" TEXT NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'member',
  "status" TEXT NOT NULL DEFAULT 'active',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_members_communityId_userId_key"
    UNIQUE ("communityId", "userId")
);
CREATE TABLE IF NOT EXISTS "social_graph_backfill_report" (
  "id" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "count" BIGINT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_graph_backfill_report_pkey" PRIMARY KEY ("id")
);
`;

const SEED = `
INSERT INTO "users" ("id", "username") VALUES
  ('ada', 'ada'), ('grace', 'grace'), ('linus', 'linus'), ('ken', 'ken');

INSERT INTO "communities" ("id", "name", "memberCount", "members") VALUES
  -- ada paid and is recorded in JSON only. grace is in both halves, and her
  -- relational row already says moderator, which must survive.
  -- ghost names a user that no longer exists.
  -- The malformed entries are the shapes the column actually contains.
  ('c1', 'Builders', 99, '[
     {"user":"ada","role":"member","status":"active"},
     {"user":"grace","role":"member","status":"active"},
     {"user":"ghost","role":"member","status":"active"},
     {"user":"linus","status":"banned"},
     "not-an-object",
     {"noUserKey":true}
   ]'::jsonb),
  -- A community whose JSON is null, not an array.
  ('c2', 'Quiet', 5, NULL),
  -- A community whose JSON is an object rather than an array.
  ('c3', 'Broken', 3, '{"user":"ada"}'::jsonb);

-- grace already holds a relational moderator row; the backfill must not
-- downgrade her to plain member.
INSERT INTO "community_members" ("id", "communityId", "userId", "role", "status")
VALUES ('m1', 'c1', 'grace', 'moderator', 'active');
`;

interface MemberRow {
  readonly userId: string;
  readonly role: string;
  readonly status: string;
}

interface CountRow {
  readonly id: string;
  readonly memberCount: number;
}

interface MetricRow {
  readonly metric: string;
  readonly count: bigint;
}

const openDatabase = async (): Promise<PGlite> => {
  const db = new PGlite();
  await db.exec(BASE_DDL);
  await db.exec(SEED);
  return db;
};

describe('community membership backfill', () => {
  it('inserts the relational rows a paid membership never got', async () => {
    const db = await openDatabase();
    try {
      await db.exec(membershipSection());

      const { rows } = await db.query<MemberRow>(
        `SELECT "userId", "role", "status" FROM "community_members"
         WHERE "communityId" = 'c1' ORDER BY "userId"`,
      );

      expect(rows).toEqual([
        { userId: 'ada', role: 'member', status: 'active' },
        // Her existing relational role survives the backfill.
        { userId: 'grace', role: 'moderator', status: 'active' },
        { userId: 'linus', role: 'member', status: 'banned' },
      ]);
    } finally {
      await db.close();
    }
  });

  it('drops entries naming a user who no longer exists', async () => {
    const db = await openDatabase();
    try {
      await db.exec(membershipSection());

      const { rows } = await db.query<{ readonly count: bigint }>(
        `SELECT count(*) AS count FROM "community_members" WHERE "userId" = 'ghost'`,
      );
      expect(Number(rows[0]?.count)).toBe(0);

      const { rows: metrics } = await db.query<MetricRow>(
        `SELECT "metric", "count" FROM "social_graph_backfill_report"
         WHERE "metric" = 'community_member_json_orphans'`,
      );
      // The drop is reported rather than silently swallowed.
      expect(Number(metrics[0]?.count)).toBe(1);
    } finally {
      await db.close();
    }
  });

  it('survives members json that is null, an object or malformed', async () => {
    const db = await openDatabase();
    try {
      await expect(db.exec(membershipSection())).resolves.toBeDefined();

      const { rows } = await db.query<{ readonly count: bigint }>(
        `SELECT count(*) AS count FROM "community_members"
         WHERE "communityId" IN ('c2', 'c3')`,
      );
      expect(Number(rows[0]?.count)).toBe(0);
    } finally {
      await db.close();
    }
  });

  it('resets the drifted member count to the active membership', async () => {
    const db = await openDatabase();
    try {
      await db.exec(membershipSection());

      const { rows } = await db.query<CountRow>(
        `SELECT "id", "memberCount" FROM "communities" ORDER BY "id"`,
      );
      expect(rows).toEqual([
        // ada and grace are active; linus is banned and is not counted.
        { id: 'c1', memberCount: 2 },
        { id: 'c2', memberCount: 0 },
        { id: 'c3', memberCount: 0 },
      ]);
    } finally {
      await db.close();
    }
  });

  it('is idempotent, so a re-run cannot duplicate a membership', async () => {
    const db = await openDatabase();
    try {
      await db.exec(membershipSection());
      await db.exec(membershipSection());
      await db.exec(membershipSection());

      const { rows } = await db.query<{ readonly count: bigint }>(
        `SELECT count(*) AS count FROM "community_members"`,
      );
      expect(Number(rows[0]?.count)).toBe(3);

      const { rows: counts } = await db.query<CountRow>(
        `SELECT "id", "memberCount" FROM "communities" WHERE "id" = 'c1'`,
      );
      expect(counts[0]?.memberCount).toBe(2);
    } finally {
      await db.close();
    }
  });

  it('reports the resulting membership total', async () => {
    const db = await openDatabase();
    try {
      await db.exec(membershipSection());

      const { rows } = await db.query<MetricRow>(
        `SELECT "metric", "count" FROM "social_graph_backfill_report"
         WHERE "metric" = 'community_member_rows_total'`,
      );
      expect(Number(rows[0]?.count)).toBe(3);
    } finally {
      await db.close();
    }
  });
});
