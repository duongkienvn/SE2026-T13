import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { useAuth } from '../auth/useAuth';
import { useAuthSession } from '../auth/auth-session-context';
import { boardKeys } from '../boards/query-keys';
import {
  receiveWorkspaceRevocation,
  clearAccessSnapshots,
} from '../realtime/access-revocation';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import {
  workspaceOverviewResponse,
  workspaceResponse as workspace,
} from '../../test/workspace-fixtures';
import { useCreateWorkspaceBoard } from './boards/hooks';
import { useWorkspaceOverview } from './hooks';
import {
  useInviteWorkspaceMember,
  useWorkspaceInvitations,
} from './members/hooks';
import { workspaceKeys } from './query-keys';
import { useForgetWorkspace } from './settings/hooks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup(overrides: Parameters<typeof mockApi>[0] = {}) {
  storeSession();
  const calls = mockApi({ 'GET /users/me': ok(testUser), ...overrides });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { client, wrapper, calls };
}
const overview = () => workspaceKeys.overview(testUser.id, 0, workspace.id);

describe('Workspace access consistency', () => {
  it('cancels in-flight Overview and Activity on mutation 404 rather than exempting an unrelated query', async () => {
    const pending = deferred<object>();
    const activityPending = deferred<object>();
    const { client, wrapper } = setup({
      'POST /boards': fail(404, 'NOT_FOUND'),
    });
    const { result } = renderHook(
      () => ({
        auth: useAuth(),
        create: useCreateWorkspaceBoard(workspace.id, true),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.auth.status).toBe('authenticated'),
    );
    const request = client
      .fetchQuery({ queryKey: overview(), queryFn: () => pending.promise })
      .catch(() => undefined);
    const activityKey = [
      ...workspaceKeys.activity(testUser.id, 0, workspace.id),
      1,
      5,
    ];
    const activityRequest = client
      .fetchQuery({
        queryKey: activityKey,
        queryFn: () => activityPending.promise,
      })
      .catch(() => undefined);
    await act(async () => {
      await result.current.create
        .mutateAsync({ name: 'First Board' })
        .catch(() => undefined);
    });
    pending.resolve({ secret: 'old Overview' });
    activityPending.resolve({ items: ['old Activity'] });
    await act(async () => {
      await Promise.all([request, activityRequest]);
    });
    expect(client.getQueryData(overview())).toBeNull();
    expect(client.getQueryData(activityKey)).toBeNull();
    client.clear();
  });
  it('invalidates Activity after a confirmed invitation command in its originating Workspace only', async () => {
    const { client, wrapper } = setup({
      [`POST /workspaces/${workspace.id}/invitations`]: ok(
        { id: 'new-invitation', sendState: 'SENT' },
        202,
      ),
    });
    const { result } = renderHook(
      () => ({
        auth: useAuth(),
        invite: useInviteWorkspaceMember(workspace.id),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.auth.status).toBe('authenticated'),
    );
    const activity = [
        ...workspaceKeys.activity(testUser.id, 0, workspace.id),
        1,
        5,
      ],
      other = [...workspaceKeys.activity(testUser.id, 0, 'other'), 1, 5];
    client.setQueryData(activity, { items: [] });
    client.setQueryData(other, { items: [] });
    await act(async () => {
      await result.current.invite.mutateAsync('recipient@example.invalid');
    });
    expect(client.getQueryState(activity)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
  it('cancels a directory request when forgetting a left/deleted Workspace', async () => {
    const pending = deferred<(typeof workspace)[]>();
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () => ({ auth: useAuth(), forget: useForgetWorkspace(workspace.id) }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.auth.status).toBe('authenticated'),
    );
    const key = workspaceKeys.list(testUser.id, 0);
    client.setQueryData(key, [workspace]);
    const request = client
      .fetchQuery({ queryKey: key, queryFn: () => pending.promise })
      .catch(() => undefined);
    act(() => result.current.forget());
    pending.resolve([workspace]);
    await act(async () => {
      await request;
    });
    expect(client.getQueryData(key)).toEqual([]);
    client.clear();
  });
  it('clears all ADMIN invitation pages on an authoritative 403 without removing Workspace membership', async () => {
    const pending = deferred<object>();
    const { client, wrapper } = setup({
      [`GET /workspaces/${workspace.id}/invitations?page=1&limit=10`]: fail(
        403,
        'FORBIDDEN',
      ),
    });
    const otherPage = [
      ...workspaceKeys.invitations(testUser.id, 0, workspace.id),
      { page: 2 },
    ];
    client.setQueryData(overview(), workspaceOverviewResponse);
    const request = client
      .fetchQuery({ queryKey: otherPage, queryFn: () => pending.promise })
      .catch(() => undefined);
    const { result } = renderHook(
      () => ({
        auth: useAuth(),
        invitations: useWorkspaceInvitations(
          workspace.id,
          { page: 1, limit: 10, status: 'ALL' },
          'ready',
          true,
        ),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.invitations.state).toBe('forbidden'),
    );
    pending.resolve({ items: ['old private recipient'] });
    await act(async () => {
      await request;
    });
    expect(client.getQueryData(otherPage)).toBeNull();
    expect(client.getQueryData(overview())).toEqual(workspaceOverviewResponse);
    client.clear();
  });
  it.each([
    'overview',
    'members',
    'guests',
    'invitations',
    'policies',
  ] as const)(
    'ignores late %s reads after socket revocation and retains another Workspace',
    async (resource) => {
      const { client } = setup();
      const key = workspaceKeys[resource](testUser.id, 0, workspace.id);
      const other = workspaceKeys.overview(testUser.id, 0, 'other');
      client.setQueryData(other, { name: 'Still authorized' });
      const pending = deferred<object>();
      const request = client
        .fetchQuery({ queryKey: key, queryFn: () => pending.promise })
        .catch(() => undefined);
      receiveWorkspaceRevocation(client, { workspaceId: workspace.id });
      pending.resolve({ secret: 'late protected data' });
      await request;
      expect(client.getQueryData(key)).toBeNull();
      expect(client.getQueryData(other)).toEqual({ name: 'Still authorized' });
      client.clear();
    },
  );
  it.each([200, 401, 403, 503])(
    'ignores an old account Overview response/status %s after session replacement',
    async (status) => {
      const pending = deferred<MockResponse>();
      const { client, wrapper } = setup({
        [`GET /workspaces/${workspace.id}/overview`]: () => pending.promise,
      });
      const { result } = renderHook(
        () => {
          const auth = useAuth();
          return {
            auth,
            scope: useAuthSession(),
            query: useWorkspaceOverview(
              auth.user?.id === testUser.id ? workspace.id : '',
            ),
          };
        },
        { wrapper },
      );
      await waitFor(() =>
        expect(result.current.auth.status).toBe('authenticated'),
      );
      const b = { ...testUser, id: 'account-b', displayName: 'Account B' };
      act(() => result.current.auth.signIn(loginResponse(b)));
      const bKey = workspaceKeys.overview(
        b.id,
        result.current.scope.generation,
        'other',
      );
      client.setQueryData(bKey, { name: 'B authorized' });
      await act(async () => {
        pending.resolve(
          status === 200
            ? ok(workspaceOverviewResponse)
            : fail(status, 'OLD_RESPONSE'),
        );
        await pending.promise;
      });
      expect(client.getQueryData(overview())).toBeUndefined();
      expect(client.getQueryData(bKey)).toEqual({ name: 'B authorized' });
      expect(result.current.auth.user?.id).toBe(b.id);
      client.clear();
    },
  );
  it('cancels Workspace reads at reconnect before REST reauthorizes', async () => {
    const { client } = setup();
    const pending = deferred<object>();
    const request = client
      .fetchQuery({ queryKey: overview(), queryFn: () => pending.promise })
      .catch(() => undefined);
    clearAccessSnapshots(client);
    pending.resolve({ secret: true });
    await request;
    expect(client.getQueryData(overview())).toBeUndefined();
    client.clear();
  });
});

describe('Workspace Board creation cache targeting', () => {
  it('invalidates the originating Workspace after a switch while leaving the destination cache alone', async () => {
    const pending = deferred<MockResponse>();
    const { client, wrapper, calls } = setup({
      'POST /boards': () => pending.promise,
    });
    const { result, rerender } = renderHook(
      ({ id }) => ({
        auth: useAuth(),
        create: useCreateWorkspaceBoard(id, true),
      }),
      { wrapper, initialProps: { id: workspace.id } },
    );
    await waitFor(() =>
      expect(result.current.auth.status).toBe('authenticated'),
    );
    const a = overview(),
      b = workspaceKeys.overview(testUser.id, 0, 'destination');
    client.setQueryData(a, {});
    client.setQueryData(b, {});
    let settled!: Promise<unknown>;
    act(() => {
      settled = result.current.create.mutateAsync({ name: 'First Board' });
    });
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST')).toBe(true),
    );
    rerender({ id: 'destination' });
    await act(async () => {
      pending.resolve(ok({ id: 'new-board' }, 201));
      await settled;
    });
    expect(client.getQueryState(a)?.isInvalidated).toBe(true);
    expect(client.getQueryState(b)?.isInvalidated).toBe(false);
    client.clear();
  });
  it.each([201, 403, 404, 503])(
    'keeps a replacement account’s caches intact when an old create settles with %s',
    async (status) => {
      const pending = deferred<MockResponse>();
      const { client, wrapper, calls } = setup({
        'POST /boards': () => pending.promise,
      });
      const { result } = renderHook(
        () => ({
          auth: useAuth(),
          scope: useAuthSession(),
          create: useCreateWorkspaceBoard(workspace.id, true),
        }),
        { wrapper },
      );
      await waitFor(() =>
        expect(result.current.auth.status).toBe('authenticated'),
      );
      let settled!: Promise<unknown>;
      act(() => {
        settled = result.current.create
          .mutateAsync({ name: 'A Board' })
          .catch(() => undefined);
      });
      await waitFor(() =>
        expect(calls.some((c) => c.method === 'POST')).toBe(true),
      );
      act(() =>
        result.current.auth.signIn(
          loginResponse({ ...testUser, id: 'account-b' }),
        ),
      );
      const b = workspaceKeys.overview(
        'account-b',
        result.current.scope.generation,
        workspace.id,
      );
      client.setQueryData(b, { name: 'B authorized' });
      client.setQueryData(boardKeys.lists(), ['B Board']);
      await act(async () => {
        pending.resolve(
          status === 201
            ? ok({ id: 'A Board' }, 201)
            : fail(status, 'OLD_RESPONSE'),
        );
        await settled;
      });
      expect(client.getQueryData(b)).toEqual({ name: 'B authorized' });
      expect(client.getQueryState(b)?.isInvalidated).toBe(false);
      expect(client.getQueryData(boardKeys.lists())).toEqual(['B Board']);
      expect(client.getQueryState(boardKeys.lists())?.isInvalidated).toBe(
        false,
      );
      client.clear();
    },
  );
  it.each([201, 403, 404, 409, 503])(
    'uses server-confirmed creation/refusal %s without touching a different Workspace',
    async (status) => {
      const { client, wrapper } = setup({
        'POST /boards':
          status === 201
            ? ok({ id: 'new-board' }, 201)
            : fail(status, 'REFUSED'),
      });
      const { result } = renderHook(
        () => ({
          auth: useAuth(),
          create: useCreateWorkspaceBoard(workspace.id, true),
        }),
        { wrapper },
      );
      await waitFor(() =>
        expect(result.current.auth.status).toBe('authenticated'),
      );
      const list = workspaceKeys.boards(testUser.id, 0, workspace.id);
      const other = workspaceKeys.overview(testUser.id, 0, 'other');
      for (const key of [overview(), list, other, boardKeys.lists()])
        client.setQueryData(key, {});
      await act(async () => {
        await result.current.create
          .mutateAsync({ name: 'First Board' })
          .catch(() => undefined);
      });
      await waitFor(() =>
        expect(result.current.create.status).toBe(
          status === 201 ? 'success' : 'error',
        ),
      );
      expect(client.getQueryState(list)?.isInvalidated).toBe(status === 201);
      expect(client.getQueryState(boardKeys.lists())?.isInvalidated).toBe(
        status === 201,
      );
      expect(client.getQueryState(other)?.isInvalidated).toBe(false);
      expect(client.getQueryData(other)).toEqual({});
      client.clear();
    },
  );
});
