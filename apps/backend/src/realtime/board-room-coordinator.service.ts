import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { RealtimeServer } from './realtime.types';

/** Single-process ordering boundary for room access, removal and broadcast. */
@Injectable()
export class BoardRoomCoordinator implements OnApplicationShutdown {
  private readonly pending = new Map<string, Promise<void>>();
  server?: RealtimeServer;

  async run<T>(boardId: string, operation: () => Promise<T> | T): Promise<T> {
    const key = boardId.toLowerCase();
    const previous = this.pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pending.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.pending.get(key) === current) this.pending.delete(key);
    }
  }

  onApplicationShutdown(): void {
    this.server = undefined;
  }
}
