import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const sql = await readFile(
      resolve('prisma/data-migrations/chat-realtime-cutover.sql'),
      'utf8',
    );
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    const result = await client.query<{ outbox: string | null }>(
      "SELECT to_regclass('public.chat_outbox_events')::text AS outbox",
    );
    if (result.rows[0]?.outbox !== 'chat_outbox_events') {
      throw new Error('Chat outbox table was not created');
    }
    console.log('CHAT_REALTIME_CUTOVER_OK');
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

void main();
