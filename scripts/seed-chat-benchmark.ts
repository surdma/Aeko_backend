import 'dotenv/config';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const ids = {
  sender: '07110000-0000-4000-8000-000000000001',
  recipient: '07110000-0000-4000-8000-000000000002',
  chat: '07110000-0000-4000-8000-000000000003',
} as const;

const legacyToken = (userId: string, secret: string): string => {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ id: userId, userId, iat: now, exp: now + 3_600 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
};

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const legacyEnv = await readFile(resolve('..', 'backend', '.env'), 'utf8');
  const secretLine = legacyEnv
    .split(/\r?\n/u)
    .find((entry) => entry.startsWith('JWT_SECRET='));
  const legacySecret = secretLine?.slice('JWT_SECRET='.length).trim();
  if (!legacySecret) throw new Error('Legacy JWT_SECRET is required');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const senderCredential = randomBytes(32).toString('base64url');
  const recipientCredential = randomBytes(32).toString('base64url');
  try {
    await prisma.$transaction(async (tx) => {
      for (const user of [
        {
          id: ids.sender,
          username: 'chat_benchmark_sender',
          email: 'chat-benchmark-sender@example.invalid',
          name: 'Chat Benchmark Sender',
        },
        {
          id: ids.recipient,
          username: 'chat_benchmark_recipient',
          email: 'chat-benchmark-recipient@example.invalid',
          name: 'Chat Benchmark Recipient',
        },
      ]) {
        await tx.user.upsert({
          where: { id: user.id },
          update: { banned: false },
          create: { ...user, emailVerified: true },
        });
      }
      await tx.chat.upsert({
        where: { id: ids.chat },
        update: {},
        create: { id: ids.chat },
      });
      for (const [id, userId] of [
        ['07110000-0000-4000-8000-000000000011', ids.sender],
        ['07110000-0000-4000-8000-000000000012', ids.recipient],
      ] as const) {
        await tx.chatMember.upsert({
          where: { chatId_userId: { chatId: ids.chat, userId } },
          update: {},
          create: { id, chatId: ids.chat, userId },
        });
      }
      await tx.session.deleteMany({
        where: { userId: { in: [ids.sender, ids.recipient] } },
      });
      await tx.session.createMany({
        data: [
          {
            id: 'chat-benchmark-sender-session',
            token: senderCredential,
            userId: ids.sender,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
          {
            id: 'chat-benchmark-recipient-session',
            token: recipientCredential,
            userId: ids.recipient,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        ],
      });
    });
    const unquote = (value: string): string =>
      value.replace(/^['"]|['"]$/gu, '');
    await writeFile(
      resolve('.chat-benchmark.local.json'),
      JSON.stringify({
        chatId: ids.chat,
        receiverId: ids.recipient,
        legacy: {
          url: 'http://127.0.0.1:9876',
          senderCredential: legacyToken(ids.sender, unquote(legacySecret)),
          recipientCredential: legacyToken(
            ids.recipient,
            unquote(legacySecret),
          ),
        },
        nest: {
          url: 'http://127.0.0.1:9877',
          senderCredential,
          recipientCredential,
        },
      }),
      { mode: 0o600 },
    );
    process.stdout.write('CHAT_BENCHMARK_SEED_OK\n');
  } finally {
    await prisma.$disconnect();
  }
};

void main();
