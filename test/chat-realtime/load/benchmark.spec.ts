import { summarizeBenchmark } from './benchmark';

describe('chat realtime benchmark summary', () => {
  it('reports delivery latency, throughput, errors, and acknowledged loss', () => {
    expect(
      summarizeBenchmark({
        target: 'nest',
        latenciesMs: [10, 20, 30, 40, 50],
        attempted: 6,
        acknowledged: 5,
        delivered: 4,
        errors: 1,
        durationMs: 2_000,
      }),
    ).toEqual({
      target: 'nest',
      latency: { p50: 30, p95: 50, p99: 50 },
      requests: { average: 2 },
      errors: 1,
      timeouts: 0,
      acknowledged: 5,
      delivered: 4,
      lostAcknowledgedMessages: 1,
      duration: 2,
    });
  });
});
