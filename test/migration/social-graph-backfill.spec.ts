import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Executes the real backfill migration against a real Postgres (PGlite, in
 * memory) seeded with the awkward shapes the legacy JSON columns actually
 * contain. A backfill that reconciles disagreeing data cannot be reviewed by
 * reading it — it has to be run.
 */

const workspace = process.cwd();

const migrationSql = (name: string): string =>
  readFileSync(
    resolve(workspace, 'prisma', 'migrations', name, 'migration.sql'),
    'utf8',
  );

/**
 * The subset of the legacy schema the backfill touches, as it exists before
 * either migration runs — no `age`, no `user_interests`.
 */
const BASE_DDL = `
CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL,
  "followers" JSONB,
  "following" JSONB,
  "followRequests" JSONB,
  "blockedUsers" JSONB,
  "notInterested" JSONB,
  "interests" JSONB
);
CREATE TABLE "posts" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id"),
  "likes" JSONB
);
CREATE TABLE "comments" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id"),
  "likes" JSONB
);
CREATE TABLE "interests" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE
);
CREATE TABLE "verification_settings" (
  "id" TEXT PRIMARY KEY,
  "updatedBy" TEXT
);
`;

const SEED = `
INSERT INTO "users" ("id", "username") VALUES
  ('ada', 'ada'), ('grace', 'grace'), ('linus', 'linus'), ('ken', 'ken');

-- ada->grace agreed by both halves.
-- ada->linus only recorded in ada.following (grace's half lost the write).
-- ken->ada only recorded in ada.followers.
-- ada->ada is a self-follow and must be dropped.
-- ada->ghost points at a user that no longer exists.
UPDATE "users" SET
  "following" = '["grace","linus","ada","ghost"]'::jsonb,
  "followers" = '["grace","ken"]'::jsonb
  WHERE "id" = 'ada';
UPDATE "users" SET
  "following" = '["ada"]'::jsonb,
  "followers" = '["ada"]'::jsonb,
  -- linus has a pending request against grace; ken's was already rejected.
  "followRequests" = '[
    {"user":"linus","requestedAt":"2026-01-01T00:00:00.000Z","status":"pending"},
    {"user":"ken","requestedAt":"2026-01-02T00:00:00.000Z","status":"rejected"}
  ]'::jsonb
  WHERE "id" = 'grace';

-- Every historical block shape, plus a dangling one.
UPDATE "users" SET "blockedUsers" = '[
  "ken",
  {"user":"grace","blockedAt":"2026-02-01T00:00:00.000Z","reason":"spam"},
  {"userId":"linus"},
  {"user":{"id":"ada"}},
  {"user":"ghost"},
  {"unexpected":true}
]'::jsonb WHERE "id" = 'ada';

INSERT INTO "posts" ("id", "userId", "likes") VALUES
  ('post-1', 'ada', '["grace","ken","ghost"]'::jsonb),
  ('post-2', 'grace', '[]'::jsonb),
  ('post-3', 'grace', 'null'::jsonb);

INSERT INTO "comments" ("id", "userId", "likes") VALUES
  ('comment-1', 'ada', '["linus"]'::jsonb);

-- notInterested is an object with a posts array, not a bare array.
UPDATE "users" SET
  "notInterested" = '{"posts":["post-2","missing-post"]}'::jsonb
  WHERE "id" = 'grace';

INSERT INTO "interests" ("id", "name") VALUES
  ('int-tech', 'technology'), ('int-art', 'art');

-- Stored by name in one row and by id in another.
UPDATE "users" SET "interests" = '["technology","int-art","nonsense"]'::jsonb
  WHERE "id" = 'ada';
`;

interface Row {
  readonly [key: string]: unknown;
}

const rowsOf = async (db: PGlite, sql: string): Promise<readonly Row[]> => {
  const result = await db.query<Row>(sql);
  return result.rows;
};

const pairs = async (
  db: PGlite,
  table: string,
  left: string,
  right: string,
  extra = '',
): Promise<readonly string[]> => {
  const rows = await rowsOf(
    db,
    `SELECT "${left}" AS l, "${right}" AS r${extra ? `, ${extra}` : ''} FROM "${table}" ORDER BY 1, 2`,
  );
  return rows.map((row) =>
    extra
      ? `${String(row.l)}->${String(row.r)}:${String(row[extra.split(' AS ')[1] ?? 'x'])}`
      : `${String(row.l)}->${String(row.r)}`,
  );
};

const metric = async (db: PGlite, name: string): Promise<number> => {
  const rows = await rowsOf(
    db,
    `SELECT "count" FROM "social_graph_backfill_report" WHERE "metric" = '${name}'`,
  );
  return Number(rows[0]?.count ?? -1);
};

describe('social graph backfill', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(BASE_DDL);
    await db.exec(SEED);
    await db.exec(migrationSql('20260810_relational_integrity_pass'));
    await db.exec(migrationSql('20260810_social_graph_tables'));
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('adds the optional age column as nullable', async () => {
    const rows = await rowsOf(
      db,
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'age'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_nullable).toBe('YES');
    expect(rows[0]?.data_type).toBe('integer');
  });

  it('resolves disagreeing followers and following by union', async () => {
    const accepted = await pairs(
      db,
      'follows',
      'followerId',
      'followeeId',
      `"state" AS state`,
    );
    expect(accepted).toEqual([
      // agreed by both halves
      'ada->grace:accepted',
      // only in ada.following — kept
      'ada->linus:accepted',
      'grace->ada:accepted',
      // only in ada.followers — kept
      'ken->ada:accepted',
      // pending request, not an accepted follow
      'linus->grace:requested',
    ]);
  });

  it('drops self-follows and edges pointing at deleted users', async () => {
    const edges = await pairs(db, 'follows', 'followerId', 'followeeId');
    expect(edges).not.toContain('ada->ada');
    expect(edges.some((edge) => edge.includes('ghost'))).toBe(false);
  });

  it('carries only pending follow requests', async () => {
    const requested = await rowsOf(
      db,
      `SELECT "followerId" FROM "follows" WHERE "state" = 'requested'`,
    );
    expect(requested.map((row) => row.followerId)).toEqual(['linus']);
  });

  it('reads every historical blockedUsers shape', async () => {
    const rows = await rowsOf(
      db,
      `SELECT "blockedId", "reason" FROM "blocks" ORDER BY "blockedId"`,
    );
    // string, {user}, {userId}, {user:{id}} — the unparseable entry and the
    // entry pointing at a deleted user are both skipped.
    expect(rows.map((row) => row.blockedId)).toEqual(['grace', 'ken', 'linus']);
    expect(rows.find((row) => row.blockedId === 'grace')?.reason).toBe('spam');
  });

  it('backfills post and comment likes, skipping unknown users', async () => {
    expect(await pairs(db, 'post_likes', 'userId', 'postId')).toEqual([
      'grace->post-1',
      'ken->post-1',
    ]);
    expect(await pairs(db, 'comment_likes', 'userId', 'commentId')).toEqual([
      'linus->comment-1',
    ]);
  });

  it('backfills not-interested from the nested posts array', async () => {
    // `missing-post` does not exist and is dropped by the join.
    expect(await pairs(db, 'not_interested', 'userId', 'postId')).toEqual([
      'grace->post-2',
    ]);
  });

  it('backfills interests stored by either name or id', async () => {
    const rows = await rowsOf(
      db,
      `SELECT "interestId" FROM "user_interests" ORDER BY "interestId"`,
    );
    expect(rows.map((row) => row.interestId)).toEqual(['int-art', 'int-tech']);
  });

  it('records the disagreement counts it reconciled', async () => {
    expect(await metric(db, 'follow_edges_total')).toBe(5);
    // ada->linus and ada->ada and ada->ghost are in `following` only.
    expect(await metric(db, 'follow_only_in_following')).toBe(3);
    // ken->ada is in `followers` only.
    expect(await metric(db, 'follow_only_in_followers')).toBe(1);
  });

  it('is idempotent when re-run', async () => {
    const before = await rowsOf(db, 'SELECT count(*)::int AS n FROM "follows"');
    await db.exec(migrationSql('20260810_social_graph_tables'));
    const after = await rowsOf(db, 'SELECT count(*)::int AS n FROM "follows"');
    expect(after[0]?.n).toBe(before[0]?.n);
  }, 120_000);

  it('adds the verification settings foreign key without dangling rows', async () => {
    await db.exec(
      `INSERT INTO "verification_settings" ("id", "updatedBy") VALUES ('vs-2', 'ada')`,
    );
    await expect(
      db.exec(
        `INSERT INTO "verification_settings" ("id", "updatedBy") VALUES ('vs-3', 'ghost')`,
      ),
    ).rejects.toThrow();
  });
});
