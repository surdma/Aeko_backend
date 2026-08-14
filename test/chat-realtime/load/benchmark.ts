import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';

export interface BenchmarkTarget {
  readonly name: 'legacy' | 'nest';
  readonly url: string;
  readonly senderCredential: string;
  readonly recipientCredential: string;
  readonly chatId: string;
  readonly receiverId: string;
  readonly iterations?: number;
  readonly timeoutMs?: number;
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

interface PublicAck {
  readonly success?: boolean;
  readonly messageId?: string;
  readonly code?: string;
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

const connect = async (
  target: BenchmarkTarget,
  credential: string,
): Promise<Socket> =>
  new Promise((resolveConnection, reject) => {
    const socket = io(target.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...(target.name === 'legacy'
        ? { auth: { token: credential } }
        : { extraHeaders: { authorization: `Bearer ${credential}` } }),
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${target.name} Socket.IO connection timed out`));
    }, target.timeoutMs ?? 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolveConnection(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });

const messageIdFromDelivery = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const direct = Reflect.get(payload, 'id');
  if (typeof direct === 'string') return direct;
  const nested = Reflect.get(payload, 'message');
  if (!nested || typeof nested !== 'object') return undefined;
  const id = Reflect.get(nested, 'id');
  return typeof id === 'string' ? id : undefined;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Socket.IO operation timed out')),
        timeoutMs,
      ),
    ),
  ]);

export const runBenchmark = async (target: BenchmarkTarget): Promise<void> => {
  const timeoutMs = target.timeoutMs ?? 5_000;
  const iterations = target.iterations ?? 100;
  const sender = await connect(target, target.senderCredential);
  const recipient = await connect(target, target.recipientCredential);
  const deliveries = new Map<string, number>();
  const waiters = new Map<string, (time: number) => void>();
  recipient.on('new_message', (payload: unknown) => {
    const id = messageIdFromDelivery(payload);
    if (!id) return;
    const time = performance.now();
    deliveries.set(id, time);
    waiters.get(id)?.(time);
    waiters.delete(id);
  });
  try {
    if (target.name === 'nest') {
      const joined = await withTimeout(
        new Promise<PublicAck>((done) =>
          recipient.emit('join_chat', { chatId: target.chatId }, done),
        ),
        timeoutMs,
      );
      if (!joined.success) throw new Error(joined.code ?? 'join_chat failed');
    }
    const latenciesMs: number[] = [];
    let acknowledged = 0;
    let delivered = 0;
    let errors = 0;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      const sentAt = performance.now();
      try {
        const input = {
          chatId: target.chatId,
          receiverId: target.receiverId,
          content: `chat-benchmark-${target.name}-${index}`,
          messageType: 'text',
          clientMessageId: `${target.name}-${Date.now()}-${index}`,
        };
        const ack = await withTimeout(
          target.name === 'nest'
            ? new Promise<PublicAck>((done) =>
                sender.emit('send_message', input, done),
              )
            : new Promise<PublicAck>((done) =>
                sender.once('message_sent', done).emit('send_message', input),
              ),
          timeoutMs,
        );
        if (!ack.messageId || (target.name === 'nest' && !ack.success)) {
          throw new Error(ack.code ?? 'send_message failed');
        }
        acknowledged += 1;
        const deliveredAt =
          deliveries.get(ack.messageId) ??
          (await withTimeout(
            new Promise<number>((done) =>
              waiters.set(ack.messageId as string, done),
            ),
            timeoutMs,
          ));
        delivered += 1;
        latenciesMs.push(deliveredAt - sentAt);
      } catch {
        errors += 1;
      }
    }
    const directory = resolve('test/chat-realtime/load/results');
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `${target.name}.json`),
      JSON.stringify(
        summarizeBenchmark({
          target: target.name,
          latenciesMs,
          attempted: iterations,
          acknowledged,
          delivered,
          errors,
          durationMs: performance.now() - startedAt,
        }),
        null,
        2,
      ),
    );
  } finally {
    sender.close();
    recipient.close();
  }
};
