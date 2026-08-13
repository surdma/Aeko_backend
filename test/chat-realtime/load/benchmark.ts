import autocannon from 'autocannon';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface BenchmarkTarget { readonly name: 'legacy' | 'nest'; readonly url: string }

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
  await writeFile(resolve(directory, `${target.name}.json`), JSON.stringify({
    target: target.name,
    latency: result.latency,
    requests: result.requests,
    throughput: result.throughput,
    errors: result.errors,
    timeouts: result.timeouts,
    duration: result.duration,
  }, null, 2));
};
