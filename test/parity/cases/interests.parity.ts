import type { HttpParityCase } from '../contracts.js';

export const interestsParityCases = [
  {
    id: 'interests:list-active:success',
    description: 'List all active interests with the complete legacy response rows',
    kind: 'http',
    method: 'GET',
    path: '/api/interests',
  },
  {
    id: 'interests:list-active:unexpected-error',
    description: 'Preserve the public 500 response while removing raw internal error disclosure',
    kind: 'http',
    method: 'GET',
    path: '/api/interests',
    intentionalExceptions: ['$.body.error'],
  },
] satisfies readonly HttpParityCase[];
