import { runBenchmark } from './benchmark';
const url = process.env.NEST_CHAT_BENCHMARK_URL;
if (!url) throw new Error('NEST_CHAT_BENCHMARK_URL is required');
await runBenchmark({ name: 'nest', url });
