import { describe, expect, it } from 'vitest';
import { compareObservations } from './http-runner.js';
import { runSocketParity } from './socket-runner.js';

describe('dual-runtime parity harness', () => {
  it('reports transport and effect differences without exposing sensitive values', () => {
    const result = compareObservations(
      {
        id: 'http:create',
        intentionalExceptions: ['$.body.error'],
        dynamicPaths: ['$.body.id'],
      },
      {
        status: 500,
        body: { message: 'failed', error: 'password=raw-secret', id: 'legacy-id' },
        headers: { authorization: 'Bearer secret' },
        effects: [
          { kind: 'database', name: 'insert', values: { amount: '10000000000000001' } },
        ],
      },
      {
        status: 503,
        body: { message: 'unavailable', id: 'nest-id' },
        headers: { authorization: 'Bearer other' },
        effects: [
          { kind: 'database', name: 'insert', values: { amount: '10000000000000002' } },
        ],
      },
    );

    expect(result.matched).toBe(false);
    expect(result.differences.map(({ path }) => path)).toContain('$.status');
    expect(result.differences.map(({ path }) => path)).toContain('$.headers.authorization');
    expect(result.differences.map(({ path }) => path)).toContain(
      '$.effects.0.values.amount',
    );
    expect(result.differences.map(({ path }) => path)).not.toContain('$.body.id');
    expect(JSON.stringify(result)).not.toContain('raw-secret');
    expect(JSON.stringify(result)).not.toContain('Bearer secret');
    expect(result.differences.find(({ path }) => path === '$.body.error')?.intentional).toBe(
      true,
    );
  });

  it('does not hide different identifiers unless the case explicitly marks them dynamic', () => {
    const strictResult = compareObservations(
      { id: 'strict-id' },
      { body: { id: 'legacy-id' }, effects: [] },
      { body: { id: 'nest-id' }, effects: [] },
    );
    const normalizedResult = compareObservations(
      { id: 'dynamic-id', dynamicPaths: ['$.body.id'] },
      { body: { id: 'legacy-id' }, effects: [] },
      { body: { id: 'nest-id' }, effects: [] },
    );

    expect(strictResult.matched).toBe(false);
    expect(strictResult.differences.map(({ path }) => path)).toContain('$.body.id');
    expect(normalizedResult.matched).toBe(true);
  });

  it('detects sensitive-value mismatches through non-reversible fingerprints', () => {
    const result = compareObservations(
      { id: 'sensitive-values' },
      { body: { password: 'alpha-secret' }, effects: [] },
      { body: { password: 'beta-secret' }, effects: [] },
    );
    const serialized = JSON.stringify(result);

    expect(result.matched).toBe(false);
    expect(result.differences.map(({ path }) => path)).toContain('$.body.password');
    expect(serialized).not.toContain('alpha-secret');
    expect(serialized).not.toContain('beta-secret');
  });

  it('compares socket events and acknowledgements', async () => {
    const result = await runSocketParity(
      {
        id: 'socket:join',
        description: 'join',
        kind: 'socket',
        namespace: '/',
        event: 'join',
        payload: {},
      },
      async () => ({
        events: [{ event: 'joined', payload: { room: 'a' }, acknowledgement: 'ok' }],
        effects: [],
      }),
      async () => ({
        events: [{ event: 'joined', payload: { room: 'b' }, acknowledgement: 'no' }],
        effects: [],
      }),
    );

    expect(result.matched).toBe(false);
    expect(result.differences.some(({ path }) => path.includes('acknowledgement'))).toBe(true);
  });
});
