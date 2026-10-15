import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import type { RealtimeServer } from './realtime.types';

export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(
    port: number,
    options?: Partial<ServerOptions>,
  ): RealtimeServer {
    const allowed = (origin: string | undefined) =>
      !origin || this.origins.includes(origin);
    return super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      // Recovery must never restore stale authentication or board memberships.
      connectionStateRecovery: undefined,
      cors: {
        origin: (origin, callback) => callback(null, allowed(origin)),
      },
      // CORS alone only protects polling; also enforce origins on WebSocket upgrades.
      allowRequest: (request, callback) =>
        callback(null, allowed(request.headers.origin)),
    } satisfies Partial<ServerOptions>) as RealtimeServer;
  }
}
