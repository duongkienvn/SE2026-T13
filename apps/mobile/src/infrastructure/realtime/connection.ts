import type { SessionManager } from '../auth/session-manager.ts';
import { systemTimers, type Timers } from '../auth/clock.ts';
import {
  currentIdentity,
  sameIdentity,
  type SessionIdentity,
} from '../api/session-client.ts';
import { SERVER_EVENTS, type ServerEvent } from './contracts.ts';
import type { NativeSocket, SocketFactory } from './socket.ts';

export interface RealtimeEnvironment {
  readonly foreground: boolean;
  readonly online: boolean;
}
export type ConnectionStatus =
  'stopped' | 'paused' | 'verifying' | 'connecting' | 'connected';
export interface ConnectionOptions {
  manager: SessionManager;
  createSocket: SocketFactory | null;
  verify(identity: SessionIdentity, signal: AbortSignal): Promise<unknown>;
  connected(socket: NativeSocket, identity: SessionIdentity): void;
  lost(): void;
  sessionEnded(): void;
  receive(event: ServerEvent, value: unknown): void;
  timers?: Timers;
}

export function createConnection(options: ConnectionOptions) {
  const timers = options.timers ?? systemTimers;
  let environment: RealtimeEnvironment = { foreground: false, online: false };
  let running = false;
  let disposed = false;
  let socket: NativeSocket | null = null;
  let identity: SessionIdentity | null = null;
  let epoch = 0;
  let attempts = 0;
  let needsVerification = false;
  let timer: unknown;
  let verification: AbortController | null = null;
  let busy = false;
  let status: ConnectionStatus = 'stopped';
  let unsubscribe: (() => void) | undefined;
  let unbind: (() => void) | undefined;
  const listeners = new Set<() => void>();
  function publish(next: ConnectionStatus) {
    status = next;
    for (const listener of [...listeners]) listener();
  }
  function eligible() {
    return (
      running &&
      !disposed &&
      environment.foreground &&
      environment.online &&
      options.createSocket !== null
    );
  }
  function clear() {
    epoch++;
    busy = false;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    verification?.abort();
    verification = null;
    const previous = socket;
    socket = null;
    previous?.removeAllListeners();
    previous?.disconnect();
    options.lost();
  }
  function retry() {
    clear();
    needsVerification = true;
    if (!eligible() || !currentIdentity(options.manager) || attempts >= 4) {
      publish('paused');
      return;
    }
    publish('paused');
    timer = timers.setTimeout(
      () => {
        timer = undefined;
        void connect();
      },
      Math.min(500 * 2 ** attempts++, 4000),
    );
  }
  async function connect() {
    if (!eligible() || socket || busy || timer !== undefined) return;
    const target = currentIdentity(options.manager);
    if (!target) return;
    identity = target;
    const ticket = epoch;
    busy = true;
    const valid = () =>
      ticket === epoch &&
      eligible() &&
      sameIdentity(target, currentIdentity(options.manager));
    if (needsVerification) {
      const controller = new AbortController();
      verification = controller;
      publish('verifying');
      try {
        await options.verify(target, controller.signal);
      } catch {
        if (valid()) retry();
        return;
      }
      if (!valid()) return;
      verification = null;
    }
    if (!valid()) return;
    const candidate = options.createSocket!(() => {
      if (!valid()) return null;
      return options.manager.getAccessCredential()?.accessToken ?? null;
    });
    socket = candidate;
    busy = false;
    publish('connecting');
    const live = () => valid() && socket === candidate;
    candidate.on('connect', () => {
      if (!live()) return;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
      needsVerification = false;
      publish('connected');
      options.connected(candidate, target);
    });
    candidate.on('disconnect', () => {
      if (live()) retry();
    });
    candidate.on('connect_error', (error) => {
      if (!live()) return;
      if (
        error &&
        typeof error === 'object' &&
        'data' in error &&
        error.data &&
        typeof error.data === 'object' &&
        'code' in error.data &&
        error.data.code === 'UNAUTHORIZED'
      ) {
        options.manager.handleUnauthorized(target.generation);
      } else retry();
    });
    for (const event of SERVER_EVENTS)
      candidate.on(event, (value) => {
        if (live() && candidate.connected) options.receive(event, value);
      });
    timer = timers.setTimeout(() => {
      if (live()) retry();
    }, 10_000);
    candidate.connect();
  }
  function reconcile() {
    const next = currentIdentity(options.manager);
    if (identity && !sameIdentity(next, identity)) {
      clear();
      options.sessionEnded();
      attempts = 0;
      needsVerification = false;
      identity = null;
    }
    if (!eligible() || !next) {
      if (socket || busy || timer !== undefined) {
        clear();
        needsVerification = true;
      }
      publish(running ? 'paused' : 'stopped');
      return;
    }
    if (!identity) identity = next;
    void connect();
  }
  function stop() {
    running = false;
    unsubscribe?.();
    unbind?.();
    unsubscribe = unbind = undefined;
    clear();
    needsVerification = true;
    publish('stopped');
  }
  return {
    getSnapshot: () => status,
    getSocket: () => socket,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnvironment(next: RealtimeEnvironment) {
      const changed =
        next.foreground !== environment.foreground ||
        next.online !== environment.online;
      if (!changed) return;
      environment = next;
      attempts = 0;
      reconcile();
    },
    start() {
      if (running || disposed) return;
      running = true;
      unsubscribe = options.manager.subscribe(reconcile);
      unbind = options.manager.addLifecycleListener({
        onSessionEnd: () => {
          clear();
          identity = null;
          attempts = 0;
          needsVerification = false;
          options.sessionEnded();
          publish('paused');
        },
      });
      reconcile();
    },
    retry() {
      if (!eligible()) return;
      attempts = 0;
      if (!socket && !busy) {
        if (timer !== undefined) timers.clearTimeout(timer);
        timer = undefined;
        void connect();
      }
    },
    restart() {
      if (eligible()) retry();
      else clear();
    },
    stop,
    dispose() {
      disposed = true;
      stop();
      options.sessionEnded();
      listeners.clear();
    },
  };
}
export type RealtimeConnection = ReturnType<typeof createConnection>;
