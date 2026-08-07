import { readFile } from 'node:fs/promises';

interface AuthEmailOutboxMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

function parseMessage(value: unknown): AuthEmailOutboxMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const to = Reflect.get(value, 'to');
  const subject = Reflect.get(value, 'subject');
  const text = Reflect.get(value, 'text');
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof text !== 'string') {
    return null;
  }
  return { to, subject, text };
}

export async function waitForVerificationUrl(email: string): Promise<URL> {
  const outboxPath = process.env.AUTH_EMAIL_OUTBOX_PATH;
  if (outboxPath === undefined) {
    throw new Error('AUTH_EMAIL_OUTBOX_PATH must be configured for runtime verification');
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const lines = (await readFile(outboxPath, 'utf8'))
        .split('\n')
        .filter((line) => line.length > 0)
        .reverse();
      for (const line of lines) {
        const message = parseMessage(JSON.parse(line) as unknown);
        if (message?.to !== email || message.subject !== 'Verify your Aeko email') {
          continue;
        }
        const urlText = /https?:\/\/\S+/u.exec(message.text)?.[0];
        if (urlText !== undefined) return new URL(urlText);
      }
    } catch (error: unknown) {
      if (Reflect.get(Object(error), 'code') !== 'ENOENT') throw error;
    }
    await new Promise((done) => setTimeout(done, 100));
  }

  throw new Error('Better Auth verification email did not reach the disposable outbox');
}
