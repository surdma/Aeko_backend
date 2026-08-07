import { rm } from 'node:fs/promises';

const nativeFetch = globalThis.fetch;
const authBaseUrl = `http://127.0.0.1:${process.env.PORT ?? '9876'}/api/auth`;
const trustedOrigin = 'http://localhost:3000';
const outboxPath = `/tmp/aeko-auth-email-${process.pid}.jsonl`;

await rm(outboxPath, { force: true });
process.env.AUTH_EMAIL_OUTBOX_PATH = outboxPath;

globalThis.fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const requestUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!requestUrl.startsWith(authBaseUrl)) return nativeFetch(input, init);

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  const overrideHeaders = new Headers(init?.headers);
  overrideHeaders.forEach((value, key) => {
    headers.set(key, value);
  });
  if (!headers.has('origin')) headers.set('origin', trustedOrigin);

  return nativeFetch(input, { ...init, headers });
};

await import('./verify-nest-runtime.mjs');
