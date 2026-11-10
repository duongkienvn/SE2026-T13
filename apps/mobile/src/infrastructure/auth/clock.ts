/** Injectable time sources so session tests run on a fake clock. */
export interface Clock {
  now(): number;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = { now: () => Date.now() };

export const systemTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Largest delay `setTimeout` accepts; longer delays fire immediately. */
export const MAX_TIMEOUT_MS = 2_147_483_647;
