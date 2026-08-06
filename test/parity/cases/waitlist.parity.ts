import type { HttpParityCase } from '../contracts.js';

export const waitlistParityCases = [
  {
    id: 'waitlist:join:success',
    description: 'Join the waitlist with normalized name and email',
    kind: 'http',
    method: 'POST',
    path: '/api/waitlist',
    body: {
      name: '  Jane Doe  ',
      email: '  JANE@EXAMPLE.COM  ',
    },
    dynamicPaths: ['$.body.data.id', '$.body.data.createdAt'],
  },
  {
    id: 'waitlist:join:missing-fields',
    description: 'Reject a request without both name and email',
    kind: 'http',
    method: 'POST',
    path: '/api/waitlist',
    body: {
      email: 'jane@example.com',
    },
  },
  {
    id: 'waitlist:join:invalid-email',
    description: 'Reject a syntactically invalid email address',
    kind: 'http',
    method: 'POST',
    path: '/api/waitlist',
    body: {
      name: 'Jane Doe',
      email: 'not-an-email',
    },
  },
  {
    id: 'waitlist:join:duplicate-email',
    description: 'Return conflict when the normalized email already exists',
    kind: 'http',
    method: 'POST',
    path: '/api/waitlist',
    body: {
      name: 'Jane Doe',
      email: 'jane@example.com',
    },
  },
  {
    id: 'waitlist:join:unexpected-error',
    description: 'Preserve the 500 status and public message without copying raw error disclosure',
    kind: 'http',
    method: 'POST',
    path: '/api/waitlist',
    body: {
      name: 'Jane Doe',
      email: 'unexpected-error@example.com',
    },
    intentionalExceptions: ['$.body.error'],
  },
] satisfies readonly HttpParityCase[];
