import { runBenchmark } from './benchmark';
const url = process.env.LEGACY_CHAT_BENCHMARK_URL;
if (!url) throw new Error('LEGACY_CHAT_BENCHMARK_URL is required');
await runBenchmark({ name: 'legacy', url });
