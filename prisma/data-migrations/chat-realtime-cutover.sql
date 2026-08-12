-- Additive, rerunnable cutover for legacy chat rows.  These columns are kept
-- nullable so the Express owner can continue writing old shapes during dual
-- run; only newly persisted Nest messages require sequence/idempotency data.
ALTER TABLE "chats"
  ADD COLUMN IF NOT EXISTS "nextMessageSequence" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "enhanced_messages"
  ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "sequence" BIGINT;

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "sequence" BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS "enhanced_messages_chatId_clientMessageId_key"
  ON "enhanced_messages" ("chatId", "clientMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "enhanced_messages_chatId_sequence_key"
  ON "enhanced_messages" ("chatId", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "messages_chatId_clientMessageId_key"
  ON "messages" ("chatId", "clientMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "messages_chatId_sequence_key"
  ON "messages" ("chatId", "sequence");

CREATE TABLE IF NOT EXISTS "chat_outbox_events" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
  "aggregateId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "chat_outbox_events_completedAt_availableAt_idx"
  ON "chat_outbox_events" ("completedAt", "availableAt");
CREATE INDEX IF NOT EXISTS "chat_outbox_events_chatId_createdAt_idx"
  ON "chat_outbox_events" ("chatId", "createdAt");
