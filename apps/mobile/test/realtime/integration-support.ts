import { QueryObserver } from '@tanstack/react-query';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import { createMobileDataLayer } from '../../src/infrastructure/query/data-layer.ts';
import { createNativeRealtime } from '../../src/infrastructure/realtime/client.ts';
import {
  queryKeys,
  type PrivateQueryKey,
} from '../../src/infrastructure/query/keys.ts';
import {
  FakeTime,
  FakeSessionApi,
  MemorySecureStore,
  USER_A,
  USER_B,
  flush,
  loginResponse,
  user,
} from '../auth/support.ts';
import { FakeSocket } from './support.ts';
export const BOARD = USER_A;
export const CARD = USER_B;
export const WORKSPACE = '33333333-3333-4333-8333-333333333333';
export const payload = { boardId: BOARD, cardId: CARD, columnId: WORKSPACE };
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
export const ok = (data: unknown) =>
  json({ success: true, statusCode: 200, message: 'OK', data });

export async function integration() {
  const time = new FakeTime();
  const sessionApi = new FakeSessionApi();
  sessionApi.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_A).accessToken ? USER_A : USER_B),
  });
  const manager = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    api: sessionApi,
    clock: time,
    timers: time,
  });
  let online = true;
  let allowed = true;
  let writable = true;
  let archived = false;
  let cardValue = 1;
  let respond:
    ((url: string, init: RequestInit) => Promise<Response> | null) | undefined;
  const requests: { url: string; init: RequestInit }[] = [];
  const transport = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    clock: time,
    timers: time,
    isOnline: () => online,
    fetch: (async (input, init) => {
      const url = String(input);
      requests.push({ url, init: init! });
      const custom = respond?.(url, init!);
      if (custom) return custom;
      if (url.endsWith('/users/me')) {
        const state = manager.getSnapshot();
        return ok(
          user(state.status === 'authenticated' ? state.user.id : USER_A),
        );
      }
      if (url.endsWith(`/boards/${BOARD}`))
        return allowed
          ? ok({
              id: BOARD,
              workspaceId: WORKSPACE,
              isArchived: archived,
              capabilities: { canReadBoard: true, canWriteBoard: writable },
            })
          : json({}, 404);
      return ok(cardValue);
    }) as typeof fetch,
  });
  const data = createMobileDataLayer(manager, transport, time);
  data.queryClient.setDefaultOptions({
    ...data.queryClient.getDefaultOptions(),
    queries: {
      ...data.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  const sockets: FakeSocket[] = [];
  const realtime = createNativeRealtime({
    manager,
    data,
    timers: time,
    createSocket: (credential) => {
      const socket = new FakeSocket(credential);
      sockets.push(socket);
      return socket;
    },
  });
  await manager.establishSession(loginResponse(USER_A));
  realtime.setEnvironment({ foreground: true, online: true });
  realtime.start();
  const stops: (() => void)[] = [];
  return {
    manager,
    data,
    realtime,
    sockets,
    requests,
    time,
    get socket() {
      return sockets.at(-1)!;
    },
    get identity() {
      return data.getIdentity()!;
    },
    get cardKey() {
      return queryKeys.card(data.getIdentity()!, BOARD, CARD);
    },
    configure(next: {
      allowed?: boolean;
      writable?: boolean;
      archived?: boolean;
      cardValue?: number;
    }) {
      if (next.allowed !== undefined) allowed = next.allowed;
      if (next.writable !== undefined) writable = next.writable;
      if (next.archived !== undefined) archived = next.archived;
      if (next.cardValue !== undefined) cardValue = next.cardValue;
    },
    respond(next: typeof respond) {
      respond = next;
    },
    environment(foreground: boolean, connected: boolean) {
      online = connected;
      realtime.setEnvironment({ foreground, online });
    },
    async join() {
      this.socket.server('connect');
      const stop = realtime.watchBoard(BOARD);
      stops.push(stop);
      await flush();
      const index = this.socket.commands.findLastIndex(
        (command) => command.event === 'board:join',
      );
      this.socket.ack(index);
      await flush();
      return stop;
    },
    observe(key: PrivateQueryKey, suffix = 'card') {
      data.queryClient.setQueryData(key, 0);
      const observer = new QueryObserver(data.queryClient, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: ({ signal }) =>
          data.api.json(`/boards/${BOARD}/${suffix}`, (value) => value, {
            identity: this.identity,
            resourceKey: key,
            signal,
            retries: 0,
          }),
      });
      const stop = observer.subscribe(() => {});
      stops.push(stop);
      return observer;
    },
    dispose() {
      stops.forEach((stop) => stop());
      realtime.dispose();
      data.dispose();
      manager.dispose();
    },
  };
}
