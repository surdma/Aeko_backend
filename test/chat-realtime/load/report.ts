import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Sample { target: string; latency: { p50: number; p95: number; p99: number }; requests: { average: number }; errors: number; timeouts: number }
const load = async (name: string): Promise<Sample> => JSON.parse(await readFile(resolve(`test/chat-realtime/load/results/${name}.json`), 'utf8')) as Sample;
const legacy = await load('legacy');
const nest = await load('nest');
const latencyBudget = legacy.latency.p95 * 1.1;
const errorBudget = legacy.errors + legacy.timeouts;
const passed = nest.latency.p95 <= latencyBudget && nest.errors + nest.timeouts <= errorBudget;
const report = `# Chat realtime benchmark\n\n| Target | p50 | p95 | p99 | req/s | errors |\n| --- | ---: | ---: | ---: | ---: | ---: |\n| Legacy | ${legacy.latency.p50} | ${legacy.latency.p95} | ${legacy.latency.p99} | ${legacy.requests.average} | ${legacy.errors + legacy.timeouts} |\n| Nest | ${nest.latency.p50} | ${nest.latency.p95} | ${nest.latency.p99} | ${nest.requests.average} | ${nest.errors + nest.timeouts} |\n\nAcceptance: Nest p95 <= ${latencyBudget.toFixed(2)} ms and errors <= ${errorBudget}. Result: ${passed ? 'PASS' : 'FAIL'}.\n`;
await writeFile(resolve('docs/nestjs-migration/chat-realtime-benchmark.md'), report);
if (!passed) process.exitCode = 1;
