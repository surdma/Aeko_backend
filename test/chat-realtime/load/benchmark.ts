import autocannon from 'autocannon';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface BenchmarkTarget {
  readonly name: 'legacy' | 'nest';
  readonly url: string;
}

export interface BenchmarkMeasurements {
  readonly target: 'legacy' | 'nest';
  readonly latenciesMs: readonly number[];
  readonly attempted: number;
  readonly acknowledged: number;
  readonly delivered: number;
  readonly errors: number;
  readonly durationMs: number;
}

const percentile = (values: readonly number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
};

export const summarizeBenchmark = (measurements: BenchmarkMeasurements) => ({
  target: measurements.target,
  latency: {
    p50: percentile(measurements.latenciesMs, 0.5),
    p95: percentile(measurements.latenciesMs, 0.95),
    p99: percentile(measurements.latenciesMs, 0.99),
  },
  requests: {
    average:
      measurements.durationMs === 0
        ? 0
        : measurements.delivered / (measurements.durationMs / 1_000),
  },
  errors: measurements.errors,
  timeouts: Math.max(
    0,
    measurements.attempted - measurements.acknowledged - measurements.errors,
  ),
  acknowledged: measurements.acknowledged,
  delivered: measurements.delivered,
  lostAcknowledgedMessages: Math.max(
    0,
    measurements.acknowledged - measurements.delivered,
  ),
  duration: measurements.durationMs / 1_000,
});

export const runBenchmark = async (target: BenchmarkTarget): Promise<void> => {
  const result = await autocannon({
    url: target.url,
    connections: 25,
    duration: 20,
    pipelining: 1,
    requests: [{ method: 'GET', path: '/health' }],
  });
  const directory = resolve('test/chat-realtime/load/results');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `${target.name}.json`),
    JSON.stringify(
      {
        target: target.name,
        latency: result.latency,
        requests: result.requests,
        throughput: result.throughput,
        errors: result.errors,
        timeouts: result.timeouts,
        duration: result.duration,
      },
      null,
      2,
    ),
  );
};
