import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { GlobalSearchResults } from '@kanban/shared';
import { describe, expect, it } from 'vitest';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import { renderApp } from '../../test/render';
import { createdSockets } from '../../test/fake-socket';
import { saveSession, SESSION_STORAGE_KEY } from '../auth/session';

const privateResults: GlobalSearchResults = {
  query: 'plan',
  type: 'all',
  groups: {
    workspaces: { items: [], total: 0, hasMore: false },
    boards: {
      items: [
        {
          type: 'board',
          id: 'b',
          title: 'Sensitive board',
          subtitle: null,
          workspaceId: 'w',
          workspaceName: null,
          path: '/boards/b',
        },
      ],
      total: 1,
      hasMore: false,
    },
    cards: { items: [], total: 0, hasMore: false },
  },
};
const emptyResults: GlobalSearchResults = {
  ...privateResults,
  groups: {
    workspaces: { items: [], total: 0, hasMore: false },
    boards: { items: [], total: 0, hasMore: false },
    cards: { items: [], total: 0, hasMore: false },
  },
};

function deferredResponse() {
  let resolve!: (response: MockResponse) => void;
  const promise = new Promise<MockResponse>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function searchForPlan() {
  fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
  fireEvent.change(
    screen.getByRole('combobox', {
      name: 'Search workspaces, boards and cards',
    }),
    { target: { value: 'plan' } },
  );
}

describe('search authentication boundary', () => {
  it('does not register its shortcut on a guest page', async () => {
    mockApi({});
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ends the current session when search receives a 401', async () => {
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /search?q=plan&type=all&limit=5': fail(401, 'UNAUTHORIZED'),
    });
    const { router } = renderApp('/boards');
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Search workspaces, boards and cards',
      }),
      {
        target: { value: 'plan' },
      },
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(localStorage.getItem('kanban.session')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides search snapshots immediately on a Board access-change event', async () => {
    storeSession();
    let calls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /search?q=plan&type=all&limit=5': () =>
        ++calls === 1 ? ok(privateResults) : new Promise(() => {}),
    });
    renderApp('/boards');
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Search workspaces, boards and cards',
      }),
      { target: { value: 'plan' } },
    );
    expect(await screen.findByText('Sensitive board')).toBeTruthy();
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    act(() =>
      createdSockets
        .at(-1)!
        .socket.push('board:access-changed', { boardId: 'b' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Sensitive board')).toBeNull(),
    );
  });

  it('discards an in-flight response that predates access revocation', async () => {
    storeSession();
    const old = deferredResponse();
    let calls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /search?q=plan&type=all&limit=5': () =>
        ++calls === 1 ? old.promise : ok(emptyResults),
    });
    renderApp('/boards');
    await searchForPlan();
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    act(() =>
      createdSockets
        .at(-1)!
        .socket.push('board:access-revoked', { boardId: 'b' }),
    );
    await waitFor(() => expect(calls).toBeGreaterThan(1));
    expect(
      await screen.findByText('No results. Try a different search.'),
    ).toBeTruthy();
    await act(async () => old.resolve(ok(privateResults)));
    expect(screen.queryByText('Sensitive board')).toBeNull();
  });

  it('does not expose a previous account’s late search after switching accounts', async () => {
    storeSession('account-a');
    const old = deferredResponse();
    const otherUser = {
      ...testUser,
      id: '00000000-0000-4000-8000-000000000002',
      displayName: 'Other User',
    };
    let oldStarted = false;
    mockApi({
      'GET /users/me': (request) =>
        ok(
          request.headers.Authorization === 'Bearer account-a'
            ? testUser
            : otherUser,
        ),
      'GET /search?q=plan&type=all&limit=5': (request) => {
        if (request.headers.Authorization === 'Bearer account-a') {
          oldStarted = true;
          return old.promise;
        }
        return ok(emptyResults);
      },
    });
    renderApp('/boards');
    await searchForPlan();
    await waitFor(() => expect(oldStarted).toBe(true));
    saveSession('account-b', 3600);
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: SESSION_STORAGE_KEY,
          storageArea: localStorage,
          newValue: localStorage.getItem(SESSION_STORAGE_KEY),
        }),
      ),
    );
    await screen.findByRole('img', { name: 'Signed in as Other User' });
    await searchForPlan();
    expect(
      await screen.findByText('No results. Try a different search.'),
    ).toBeTruthy();
    await act(async () => old.resolve(ok(privateResults)));
    expect(screen.queryByText('Sensitive board')).toBeNull();
  });

  it.each(['workspace revocation', 'connection loss'] as const)(
    'clears protected results on %s and waits for a fresh read',
    async (event) => {
      storeSession();
      let calls = 0;
      mockApi({
        'GET /users/me': ok(testUser),
        'GET /search?q=plan&type=all&limit=5': () =>
          ++calls === 1
            ? ok(privateResults)
            : event === 'connection loss'
              ? ok(emptyResults)
              : new Promise(() => {}),
      });
      renderApp('/boards');
      await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
      const socket = createdSockets.at(-1)!.socket;
      act(() => socket.open());
      await searchForPlan();
      expect(await screen.findByText('Sensitive board')).toBeTruthy();
      act(() => {
        if (event === 'workspace revocation')
          socket.push('workspace:access-revoked', { workspaceId: 'w' });
        else socket.drop();
      });
      await waitFor(() =>
        expect(screen.queryByText('Sensitive board')).toBeNull(),
      );
      if (event === 'connection loss') {
        act(() => socket.open());
        expect(
          await screen.findByText('No results. Try a different search.'),
        ).toBeTruthy();
        expect(calls).toBeGreaterThan(1);
      }
    },
  );
});
