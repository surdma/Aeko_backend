import { Injectable } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { Server } from 'socket.io';
import { RealtimeHealthService } from './realtime-health.service';
import { RedisConnectionsService } from './redis-connections.service';

@Injectable()
export class SocketIoRedisAdapter extends IoAdapter {
  constructor(
    private readonly connections: RedisConnectionsService,
    private readonly health: RealtimeHealthService,
  ) {
    super();
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    const publisher = this.connections.publisher();
    const subscriber = this.connections.subscriber();
    if (publisher && subscriber) {
      server.adapter(createAdapter(publisher, subscriber));
      this.health.markAdapterReady();
    }
    return server;
  }
}
