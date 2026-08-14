import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runBenchmark, type BenchmarkTarget } from './benchmark';

interface Configuration {
  readonly chatId: string;
  readonly receiverId: string;
  readonly legacy: Pick<
    BenchmarkTarget,
    'url' | 'senderCredential' | 'recipientCredential'
  >;
}

const main = async (): Promise<void> => {
  const configuration = JSON.parse(
    await readFile(resolve('.chat-benchmark.local.json'), 'utf8'),
  ) as Configuration;
  await runBenchmark({
    name: 'legacy',
    chatId: configuration.chatId,
    receiverId: configuration.receiverId,
    ...configuration.legacy,
  });
};

void main();
