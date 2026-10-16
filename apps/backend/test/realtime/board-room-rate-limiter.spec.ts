import {
  BoardRoomRateLimiter,
  BOARD_ROOM_REQUEST_LIMITS,
} from '../../src/realtime/board-room-rate-limiter.service';

describe('BoardRoomRateLimiter lifecycle', () => {
  it('expires idle user windows, retains pending reservations and clears shutdown state', () => {
    jest.useFakeTimers();
    const limiter = new BoardRoomRateLimiter();
    try {
      const releaseIdle = limiter.acquire('idle')!;
      const releasePending = limiter.acquire('pending')!;
      releaseIdle();
      releaseIdle();
      jest.advanceTimersByTime(BOARD_ROOM_REQUEST_LIMITS.windowMs);
      expect(limiter['windows'].has('idle')).toBe(false);
      expect(limiter['windows'].has('pending')).toBe(true);
      releasePending();
      jest.advanceTimersByTime(BOARD_ROOM_REQUEST_LIMITS.windowMs);
      expect(limiter['windows'].size).toBe(0);
      limiter.onApplicationShutdown();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      limiter.onApplicationShutdown();
      jest.useRealTimers();
    }
  });
});
