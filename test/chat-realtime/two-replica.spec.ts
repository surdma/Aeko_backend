import 'dotenv/config';
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';

const redisUrl = (): string => {
  const value = process.env.REDIS_URL;
  if (!value)
    throw new Error('REDIS_URL is required for the two-replica proof');
  return value;
};

const listen = async (server: HttpServer): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

const connect = async (port: number): Promise<Socket> => {
  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
};

describe('two-replica Redis fan-out', () => {
  jest.setTimeout(30_000);
  const namespace = `aeko:test:chat-realtime:${process.pid}`;
  const httpServers: HttpServer[] = [];
  const ioServers: Server[] = [];
  const clients: Socket[] = [];
  const redisClients: Redis[] = [];

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    await Promise.all(ioServers.map((server) => server.close()));
    await Promise.all(
      httpServers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    await Promise.all(
      redisClients.map((client) =>
        client.quit().catch(() => client.disconnect()),
      ),
    );
  });

  it('delivers a room event from replica A to a recipient on replica B', async () => {
    const ports: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      const publisher = new Redis(redisUrl(), {
        lazyConnect: true,
        connectTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const subscriber = publisher.duplicate();
      publisher.on('error', () => undefined);
      subscriber.on('error', () => undefined);
      redisClients.push(publisher, subscriber);
      await Promise.all([publisher.connect(), subscriber.connect()]);
      const http = createServer();
      const ioServer = new Server(http, { transports: ['websocket'] });
      ioServer.adapter(
        createAdapter(publisher, subscriber, { key: namespace }),
      );
      ioServer.on('connection', (socket) => {
        socket.on(
          'join_chat',
          async (chatId: string, ack: (value: unknown) => void) => {
            await socket.join(`aeko:chat:${chatId}`);
            ack({ success: true });
          },
        );
      });
      httpServers.push(http);
      ioServers.push(ioServer);
      ports.push(await listen(http));
    }

    const [replicaAPort, replicaBPort] = ports;
    const replicaA = ioServers[0];
    if (
      replicaAPort === undefined ||
      replicaBPort === undefined ||
      replicaA === undefined
    ) {
      throw new Error('Both realtime replicas must be listening');
    }
    const sender = await connect(replicaAPort);
    const recipient = await connect(replicaBPort);
    clients.push(sender, recipient);
    await recipient.emitWithAck('join_chat', 'chat-1');
    const received = new Promise<unknown>((resolve) =>
      recipient.once('new_message', resolve),
    );
    replicaA
      .to('aeko:chat:chat-1')
      .emit('new_message', { id: 'message-1', sequence: 1 });
    await expect(received).resolves.toEqual({ id: 'message-1', sequence: 1 });
  });
});
