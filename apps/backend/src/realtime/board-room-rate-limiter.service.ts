import { Injectable, OnApplicationShutdown } from '@nestjs/common';

export const BOARD_ROOM_REQUEST_LIMITS = {
  windowMs: 10_000,
  requests: 60,
  pending: 4,
} as const;

interface RequestWindow {
  resetsAt: number;
  requests: number;
  pending: number;
}

/** Shared by join/leave and all connections of an authenticated user. */
@Injectable()
export class BoardRoomRateLimiter implements OnApplicationShutdown {
  private readonly windows = new Map<string, RequestWindow>();
  private readonly cleanup = setInterval(() => {
    const now = Date.now();
    for (const [userId, window] of this.windows) {
      if (window.pending === 0 && window.resetsAt <= now) {
        this.windows.delete(userId);
      }
    }
  }, BOARD_ROOM_REQUEST_LIMITS.windowMs);

  constructor() {
    this.cleanup.unref();
  }

  /** Reserve synchronously before queueing/DB work; release in the caller's finally. */
  acquire(userId: string): (() => void) | undefined {
    const now = Date.now();
    let window = this.windows.get(userId);
    if (!window) {
      window = { resetsAt: now, requests: 0, pending: 0 };
      this.windows.set(userId, window);
    }
    if (now >= window.resetsAt) {
      window.requests = 0;
      window.resetsAt = now + BOARD_ROOM_REQUEST_LIMITS.windowMs;
    }
    if (
      window.requests >= BOARD_ROOM_REQUEST_LIMITS.requests ||
      window.pending >= BOARD_ROOM_REQUEST_LIMITS.pending
    ) {
      return undefined;
    }
    window.requests++;
    window.pending++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      window.pending--;
    };
  }

  onApplicationShutdown(): void {
    clearInterval(this.cleanup);
    this.windows.clear();
  }
}
