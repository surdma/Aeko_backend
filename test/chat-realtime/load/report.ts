import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Sample {
  readonly target: string;
  readonly latency: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly requests: { readonly average: number };
  readonly errors: number;
  readonly timeouts: number;
  readonly acknowledged: number;
  readonly delivered: number;
  readonly lostAcknowledgedMessages: number;
}

const load = async (name: string): Promise<Sample> =>
  JSON.parse(
    await readFile(
      resolve(`test/chat-realtime/load/results/${name}.json`),
      'utf8',
    ),
  ) as Sample;

const main = async (): Promise<void> => {
  const legacy = await load('legacy');
  const nest = await load('nest');
  const latencyBudget = legacy.latency.p95 * 1.1;
  const errorBudget = legacy.errors + legacy.timeouts;
  const passed =
    nest.latency.p95 <= latencyBudget &&
    nest.errors + nest.timeouts <= errorBudget &&
    nest.lostAcknowledgedMessages === 0;
  const report = `# Chat realtime benchmark\n\nAuthenticated Socket.IO workload against the same local PostgreSQL data, two principals, one chat membership set, 100 sequential persisted messages, WebSocket-only transport, and first recipient delivery matched by persisted message ID.\n\n| Target | p50 ms | p95 ms | p99 ms | delivered/s | ack | delivered | errors | acknowledged loss |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n| Legacy | ${legacy.latency.p50.toFixed(2)} | ${legacy.latency.p95.toFixed(2)} | ${legacy.latency.p99.toFixed(2)} | ${legacy.requests.average.toFixed(2)} | ${legacy.acknowledged} | ${legacy.delivered} | ${legacy.errors + legacy.timeouts} | ${legacy.lostAcknowledgedMessages} |\n| Nest | ${nest.latency.p50.toFixed(2)} | ${nest.latency.p95.toFixed(2)} | ${nest.latency.p99.toFixed(2)} | ${nest.requests.average.toFixed(2)} | ${nest.acknowledged} | ${nest.delivered} | ${nest.errors + nest.timeouts} | ${nest.lostAcknowledgedMessages} |\n\nAcceptance: Nest p95 <= ${latencyBudget.toFixed(2)} ms, errors <= ${errorBudget}, and acknowledged loss = 0. Result: ${passed ? 'PASS' : 'FAIL'}.\n`;
  await writeFile(
    resolve('docs/nestjs-migration/chat-realtime-benchmark.md'),
    report,
  );
  if (!passed) process.exitCode = 1;
};

void main();
