import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cutoverSql = (): string =>
  readFileSync(
    resolve(process.cwd(), 'prisma/data-migrations/chat-realtime-cutover.sql'),
    'utf8',
  );

const LEGACY_DDL = `
CREATE TABLE "chats" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "enhanced_messages" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "chats"("id"),
  "content" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "messages" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT REFERENCES "chats"("id"),
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL
);
INSERT INTO "chats" ("id", "createdAt") VALUES ('chat-1', '2025-01-01T00:00:00.000Z');
INSERT INTO "enhanced_messages" ("id", "chatId", "content", "createdAt") VALUES ('enhanced-1', 'chat-1', 'legacy enhanced', '2025-01-02T00:00:00.000Z');
INSERT INTO "messages" ("id", "chatId", "message", "createdAt") VALUES ('message-1', 'chat-1', 'legacy message', '2025-01-03T00:00:00.000Z');
`;

interface Row {
  readonly [key: string]: unknown;
}

describe('chat realtime cutover', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`SET TIME ZONE 'UTC'`);
    await db.exec(LEGACY_DDL);
    await db.exec(cutoverSql());
    await db.exec(cutoverSql());
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('is additive and preserves legacy message identity, body, and timestamp', async () => {
    const result = await db.query<Row>(
      `SELECT "id", "content", to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "createdAtText", "clientMessageId", "sequence"
       FROM "enhanced_messages" WHERE "id" = 'enhanced-1'`,
    );
    expect(result.rows).toEqual([
      {
        id: 'enhanced-1',
        content: 'legacy enhanced',
        createdAtText: '2025-01-02T00:00:00.000',
        clientMessageId: null,
        sequence: null,
      },
    ]);

    const legacyMessage = await db.query<Row>(
      `SELECT "id", "message", to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "createdAtText", "clientMessageId", "sequence"
       FROM "messages" WHERE "id" = 'message-1'`,
    );
    expect(legacyMessage.rows).toEqual([
      {
        id: 'message-1',
        message: 'legacy message',
        createdAtText: '2025-01-03T00:00:00.000',
        clientMessageId: null,
        sequence: null,
      },
    ]);
  });

  it('adds the outbox and per-chat counter without rewriting legacy rows', async () => {
    const result = await db.query<Row>(
      `SELECT "nextMessageSequence" FROM "chats" WHERE "id" = 'chat-1'`,
    );
    expect(result.rows[0]?.nextMessageSequence).toBe(0);
    await db.exec(
      `INSERT INTO "chat_outbox_events" ("id", "chatId", "aggregateId", "eventType", "payload")
       VALUES ('event-1', 'chat-1', 'enhanced-1', 'chat.message.created', '{"messageId":"enhanced-1"}'::jsonb)`,
    );
    const outbox = await db.query<Row>(
      `SELECT "aggregateId" FROM "chat_outbox_events"`,
    );
    expect(outbox.rows).toEqual([{ aggregateId: 'enhanced-1' }]);
  });
});
