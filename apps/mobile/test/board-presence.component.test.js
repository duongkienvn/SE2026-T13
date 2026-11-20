/* global jest, test, expect, afterEach */
import React from 'react';
import { URL } from 'node:url';
import { render, screen } from '@testing-library/react-native';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createHttpClient } from '../src/infrastructure/api/client';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { BoardPresence } from '../src/features/boards/BoardPresence';
import { ThemeContext } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  loginResponse,
  user,
} from './auth/support';
import { boardId, timestamp } from './workspaces/kanban-fixtures';
import { uuid } from './workspaces/fixtures';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));

const ADA = uuid(7001);
const BEN = uuid(7002);
const STRANGER = uuid(7999);
const member = (id, displayName, n) => ({
  id: uuid(7500 + n),
  user: {
    id,
    email: `${displayName.toLowerCase()}@example.test`,
    displayName,
    avatarUrl: null,
    avatarRevision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  role: 'MEMBER',
  joinedAt: timestamp,
});
const roster = [
  member(USER_A, 'Me', 1),
  member(ADA, 'Ada', 2),
  member(BEN, 'Ben', 3),
];
const response = (data, meta) => ({
  status: 200,
  ok: true,
  headers: { get: (k) => (k === 'content-type' ? 'application/json' : null) },
  text: async () =>
    JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'OK',
      data,
      meta,
    }),
});
const mounted = [];
afterEach(async () => {
  for (const env of mounted.splice(0)) {
    await env.view.unmount();
    env.data.dispose();
    env.manager.dispose();
  }
});

async function setup(props) {
  const time = new FakeTime();
  const auth = new FakeSessionApi();
  auth.auto = () => ({ kind: 'verified', user: user(USER_A) });
  const manager = createSessionManager({
    api: auth,
    store: createCredentialStore(new MemorySecureStore()),
    clock: time,
    timers: time,
  });
  await manager.establishSession(loginResponse(USER_A));
  const requests = [];
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://example.test/api'),
      clock: time,
      timers: time,
      fetch: async (input) => {
        const url = new URL(input);
        requests.push(url.pathname);
        return response(roster, {
          page: 1,
          limit: 100,
          total: 3,
          totalPages: 1,
        });
      },
    }),
    time,
  );
  const identity = data.getIdentity();
  const tree = (next) => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value="light">
          <BoardPresence
            identity={identity}
            boardId={boardId}
            boardReadable
            explicitMember
            {...next}
          />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>
  );
  const view = await render(tree(props));
  const env = {
    view,
    data,
    manager,
    requests,
    rerender: (n) => view.rerender(tree(n)),
  };
  mounted.push(env);
  return env;
}
const room = (userIds, status = 'live') => ({
  status,
  canRead: status === 'live',
  canWrite: true,
  userIds,
});

test('explicit members see roster names; unknown present users are only counted', async () => {
  const env = await setup({ room: room([USER_A, ADA, BEN, STRANGER]) });
  await screen.findByLabelText('Viewing this board now: Ada, Ben and 1 more');
  expect(screen.getByText('+1 viewing')).toBeTruthy();
  expect(env.requests).toEqual([`/api/boards/${boardId}/members`]);
});

test('a Workspace read-only viewer sees a count and never requests the roster', async () => {
  const env = await setup({
    room: room([USER_A, ADA, BEN]),
    explicitMember: false,
  });
  await screen.findByLabelText('2 other people viewing this board now');
  expect(screen.getByText('2 viewing')).toBeTruthy();
  expect(screen.queryByText('Ada')).toBeNull();
  expect(env.requests).toEqual([]);
});

test('nothing renders before join, while paused, after revoke, or when alone', async () => {
  const env = await setup({ room: room([USER_A, ADA], 'joining') });
  expect(screen.queryByTestId('board-presence')).toBeNull();
  await env.rerender({ room: room([USER_A, ADA], 'paused') });
  expect(screen.queryByTestId('board-presence')).toBeNull();
  await env.rerender({ room: room([], 'unavailable') });
  expect(screen.queryByTestId('board-presence')).toBeNull();
  await env.rerender({ room: room([USER_A]) });
  expect(screen.queryByTestId('board-presence')).toBeNull();
  await env.rerender({ room: room([USER_A, ADA]), boardReadable: false });
  expect(screen.queryByTestId('board-presence')).toBeNull();
  expect(env.requests).toEqual([]);
});
