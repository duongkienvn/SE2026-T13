import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { RealtimeIoAdapter } from '../src/realtime/realtime-io.adapter';

describe('RealtimeIoAdapter', () => {
  it('uses the configured origins for polling and WebSocket, outside the REST prefix', () => {
    const create = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue({});
    try {
      const adapter = new RealtimeIoAdapter(
        { getHttpServer: () => ({}) } as INestApplication,
        ['https://kanban.test'],
      );
      adapter.createIOServer(0);
      const options = create.mock.calls[0][1] as ServerOptions;
      expect(options.path).toBe('/socket.io');
      expect(options.connectionStateRecovery).toBeUndefined();
      const callback = jest.fn();
      if (!options.cors || typeof options.cors === 'function') {
        throw new Error('Missing CORS options');
      }
      const origin = options.cors.origin;
      if (typeof origin !== 'function')
        throw new Error('Missing CORS callback');
      origin('https://kanban.test', callback);
      expect(callback).toHaveBeenLastCalledWith(null, true);
      origin('https://other.test', callback);
      expect(callback).toHaveBeenLastCalledWith(null, false);
      options.allowRequest!(
        { headers: { origin: 'https://other.test' } } as never,
        callback,
      );
      expect(callback).toHaveBeenLastCalledWith(null, false);
      options.allowRequest!({ headers: {} } as never, callback);
      expect(callback).toHaveBeenLastCalledWith(null, true);
    } finally {
      create.mockRestore();
    }
  });
});
