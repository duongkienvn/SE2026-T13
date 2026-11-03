import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { workspaceKeys } from '../workspaces/query-keys';
import { boardKeys } from './query-keys';
import { revokeBoardAccess } from './revoke-board-access';

describe('Board access loss in Workspace caches', () => {
  it('hides cached pages and totals before rechecking grants, preserving independent Workspace membership', () => {
    const client = new QueryClient();
    const overviewKey = workspaceKeys.overview('user', 3, 'workspace');
    const boardsKey = workspaceKeys.boards('user', 3, 'workspace');
    const directoryKey = workspaceKeys.list('user', 3);
    client.setQueryData(directoryKey, [
      { id: 'workspace', name: 'Member workspace' },
    ]);
    client.setQueryData(overviewKey, {
      visibleBoardCount: 22,
      recentBoards: [{ id: 'revoked', name: 'Protected Board' }],
    });
    client.setQueryData([...boardsKey, { page: 1 }], { total: 22, items: [] });
    client.setQueryData([...boardsKey, { page: 2 }], {
      total: 22,
      items: [{ id: 'revoked', name: 'Protected Board' }],
    });
    client.setQueryData(boardKeys.detail('revoked'), {
      name: 'Protected Board',
    });
    const starKey = ['board-discovery', 'user', 3, 'state', 'REVOKED'];
    client.setQueryData(starKey, { isStarred: true });

    revokeBoardAccess(client, 'revoked');

    for (const query of client
      .getQueryCache()
      .findAll({ queryKey: workspaceKeys.resource('user', 3, 'workspace') })) {
      expect(query.state.data).toBeNull();
      expect(query.state.status).toBe('error');
      expect(query.state.isInvalidated).toBe(true);
    }
    expect(client.getQueryData(directoryKey)).toEqual([
      { id: 'workspace', name: 'Member workspace' },
    ]);
    expect(client.getQueryData(boardKeys.detail('revoked'))).toBeUndefined();
    expect(client.getQueryData(starKey)).toBeUndefined();
    client.clear();
  });
});

it('notifies an active global list and rejects its late response after access is revoked', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = [...boardKeys.lists(), 'user', 1, 'discovery'];
  const protectedPage = {
    items: [{ id: 'revoked', name: 'Protected Board' }],
    meta: { total: 1 },
  };
  client.setQueryData(key, protectedPage);
  let finish!: (value: typeof protectedPage) => void;
  const pending = new Promise<typeof protectedPage>((resolve) => {
    finish = resolve;
  });
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => pending,
  });
  let visible: typeof protectedPage | undefined = protectedPage;
  const unsubscribe = observer.subscribe((result) => {
    visible = result.data;
  });
  const refresh = observer.refetch();
  revokeBoardAccess(client, 'revoked');
  expect(visible).toBeUndefined();
  finish(protectedPage);
  await refresh;
  expect(client.getQueryData(key)).toBeUndefined();
  expect(visible).toBeUndefined();
  unsubscribe();
  client.clear();
});
