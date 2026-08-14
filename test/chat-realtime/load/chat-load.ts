import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runBenchmark, type BenchmarkTarget } from './benchmark';

interface Configuration {
  readonly chatId: string;
  readonly receiverId: string;
  readonly nest: Pick<
    BenchmarkTarget,
    'url' | 'senderCredential' | 'recipientCredential'
  >;
}

const main = async (): Promise<void> => {
  const configuration = JSON.parse(
    await readFile(resolve('.chat-benchmark.local.json'), 'utf8'),
  ) as Configuration;
  await runBenchmark({
    name: 'nest',
    chatId: configuration.chatId,
    receiverId: configuration.receiverId,
    ...configuration.nest,
  });
};

void main();
